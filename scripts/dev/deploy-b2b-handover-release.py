#!/usr/bin/env python3
"""Plan ERP DEV release phases and record their observed results; no cloud writes.

  init --state-dir /tmp/erp-b2b-release --context-dir /tmp/erp-b2b-build \
    --build-id UUID --migration-receipt /tmp/migrations.json [--enable-b2b]
  check-phase --phase candidate-api --state-dir /tmp/erp-b2b-release
  record-phase --phase candidate-api --state-dir /tmp/erp-b2b-release

Repeat check/record for candidate-web, final-web, promote-api, promote-web.
Only check-phase prints a proposed gcloud command, after a fresh comparison.
An independently authorized operator executes it; this helper cannot execute,
submit, read secret payloads, migrate, change IAM, or target production/WMS.
Do not execute a saved command after a delay: rerun check-phase immediately.
The external operation is not atomic with this read-only preflight; an operator
must coordinate the shared DEV release window. record-phase never assumes that
an external operation succeeded and only accepts the exact Ready result.

Promotion requires --acceptance-receipt PATH on check-phase, a private JSON
record binding sourceSha, buildId, images, candidateRevisions, validatedAt and
checks {authentication, permissions, affectedWorkflows, visibleUi}: all true.
Functional acceptance is performed by a person/test harness, never inferred by
this helper. B2B, if explicitly enabled, also needs checks.b2bPortal=true.
Final-web uses stable API; candidate-web is isolated to the tagged candidate API.
Original tags, runtime configuration and 100% old traffic remain until promotion.
"""
import argparse
import copy
from datetime import timedelta
import fcntl
import json
import os
from pathlib import Path
import shlex

import b2b_release as release

PHASES = ('candidate-api', 'candidate-web', 'final-web', 'promote-api', 'promote-web')


def next_phase(state, phase):
    done = [p['phase'] for p in state['completed']]
    release.require(done == list(PHASES[:len(done)]), 'Invalid phase history')
    release.require(len(done) < len(PHASES) and phase == PHASES[len(done)],
                    'Phase must follow the recorded order')


def source_receipts(state):
    manifest = release.verify_context(Path(state['context']))
    release.require(manifest['sourceSha'] == state['sourceSha'] and
                    release.digest_file(Path(state['context']) / 'manifest.json') == state['manifestSha256'],
                    'Build manifest changed')
    receipt = release.migration_receipt(Path(state['migrationReceipt']['path']), state['sourceSha'])
    release.require(receipt == state['migrationReceipt'], 'Migration receipt changed')


def check_current(state):
    source_receipts(state)
    live = release.snapshot_all()
    release.assert_snapshot(state['expected'], live)
    return live


def initialize(args, directory):
    release.require(args.context_dir and args.build_id and args.migration_receipt,
                    'init requires context, successful build ID and separate migration receipt')
    release.require(not (directory / 'state.json').exists(), 'Refusing existing release state')
    context = release.private_directory(args.context_dir)
    manifest = release.verify_context(context)
    source = manifest['sourceSha']
    release.require(release.clean_source() == source, 'Source must still be clean and match the built commit')
    release.verify_source(source, manifest['baseline']['liveSourceSha'])
    receipt = release.migration_receipt(args.migration_receipt, source)
    build = release.cloud('build', args.build_id)
    images = release.build_images(build, source)
    expected_config = json.loads((context / 'cloudbuild.json').read_text())
    release.require(build.get('tags') == expected_config['tags'], 'Build source tag differs from context')
    steps = build.get('steps', [])
    release.require(len(steps) == len(expected_config['steps']) and
                    all(all(actual.get(k) == value for k, value in expected.items())
                        for actual, expected in zip(steps, expected_config['steps'])),
                    'Cloud Build steps differ from reviewed context')
    live = release.snapshot_all()
    release.assert_snapshot(manifest['baseline']['services'], live)
    suffix = 'b2b-' + source[:12]
    candidate_tag, final_tag = suffix + '-candidate', suffix + '-final'
    for name in release.DEV:
        release.require(not ({candidate_tag, final_tag} & set(release.tags(live[name]))), 'Release tag already exists')
    state = {'version': 1, 'project': release.PROJECT, 'region': release.REGION,
             'createdAt': release.timestamp(), 'sourceSha': source, 'buildId': args.build_id,
             'context': str(context), 'manifestSha256': release.digest_file(context / 'manifest.json'),
             'images': images, 'migrationReceipt': receipt, 'enableB2b': bool(args.enable_b2b),
             'baseline': live, 'expected': live, 'completed': [],
             'rollbackRevisions': {s: release.active(live[s])[0][0] for s in release.DEV},
             'tags': {'candidate': candidate_tag, 'final': final_tag},
             'revisions': {'candidate-api': release.API + '-' + suffix + '-c',
                           'candidate-web': release.WEB + '-' + suffix + '-c',
                           'final-web': release.WEB + '-' + suffix + '-f'},
             'urls': {s: live[s]['status']['url'] for s in release.DEV}}
    for revision in state['revisions'].values():
        release.require(len(revision) <= 63, 'Revision name too long')
    for phase in ('candidate-api', 'candidate-web', 'final-web'):
        service = release.API if phase == 'candidate-api' else release.WEB
        tag = final_tag if phase == 'final-web' else candidate_tag
        state['urls'][phase] = release.tagged_url(state['urls'][service], tag)
    # Specs for all phases are review artifacts only, not evidence of completion.
    simulation = copy.deepcopy(live)
    review = []
    for phase in PHASES:
        service, spec = planned_spec(phase, state, simulation)
        release.private_json(directory / (phase + '-review-spec.json'), spec)
        review.append({'phase': phase, 'service': service, 'image': release.image_of(spec),
                       'specSha256': release.fingerprint(spec)})
        simulation[service] = spec
    release.private_json(directory / 'state.json', state)
    return {'mode': 'plan-only', 'stateDir': str(directory), 'sourceSha': source,
            'migrationReceiptSha256': receipt['sha256'], 'phases': review, 'urls': state['urls'],
            'wmsIntegrationEnabled': False, 'cloudMutationExecuted': False}


def planned_spec(phase, state, live):
    release.require(phase in PHASES, 'Unknown release phase')
    name = release.API if phase in ('candidate-api', 'promote-api') else release.WEB
    result = release.portable(live[name])
    if phase.startswith('promote-'):
        revision = state['revisions']['candidate-api' if name == release.API else 'final-web']
        result['spec']['traffic'] = [{k: v for k, v in item.items() if k not in ('percent', 'url')}
                                     for item in result['spec'].get('traffic', []) if item.get('tag')]
        result['spec']['traffic'].append({'revisionName': revision, 'percent': 100})
    else:
        result['spec']['template'].setdefault('metadata', {})['name'] = state['revisions'][phase]
        result['spec']['template']['spec']['containers'][0]['image'] = state['images'][name]
        if name == release.API:
            origins = release.env_map(result).get('CORS_ORIGIN', {}).get('value', '').split(',')
            origins = list(dict.fromkeys(o.strip() for o in origins if o.strip()))
            release.require(origins and all('*' not in origin for origin in origins), 'CORS needs a finite allowlist')
            for origin in (state['urls']['candidate-web'], state['urls']['final-web']):
                if origin not in origins:
                    origins.append(origin)
            release.set_env(result, 'CORS_ORIGIN', ','.join(origins))
            if state['enableB2b']:
                release.set_env(result, 'B2B_PORTAL_ENABLED', 'true')
        else:
            api = state['urls']['candidate-api'] if phase == 'candidate-web' else state['urls'][release.API]
            release.set_env(result, 'API_URL', api + '/api/v1')
            release.set_env(result, 'WS_URL', api)
        tag = state['tags']['final' if phase == 'final-web' else 'candidate']
        release.require(tag not in release.tags(result), 'Refusing to overwrite an existing tag')
        release.require(all(not item.get('latestRevision') for item in result['spec']['traffic']),
                        'Implicit latest routing needs review')
        result['spec']['traffic'].append({'revisionName': state['revisions'][phase], 'tag': tag})
    release.guards(result)
    release.require(sum(i.get('percent', 0) for i in result['spec']['traffic']) == 100, 'Traffic must total 100%')
    for tag, revision in release.tags(live[name]).items():
        release.require(release.tags(result).get(tag) == revision, 'Existing traffic tag changed')
    allowed = ({'CORS_ORIGIN', 'B2B_PORTAL_ENABLED'} if name == release.API else {'API_URL', 'WS_URL'})
    old_env, new_env = release.env_map(live[name]), release.env_map(result)
    for key in set(old_env) | set(new_env):
        release.require(key in allowed or new_env.get(key) == old_env.get(key), 'Unrelated environment changed: ' + key)
    return name, result


def acceptance_receipt(path, state):
    release.require(path is not None, 'Promotion needs a separate functional acceptance receipt')
    value = release.private_read(path)
    for key in ('sourceSha', 'buildId', 'images'):
        release.require(value.get(key) == state[key], 'Acceptance receipt differs: ' + key)
    release.require(value.get('version') == 1 and value.get('candidateRevisions') == state['revisions'],
                    'Acceptance receipt has wrong candidate revisions')
    validated = release.parse_time(value.get('validatedAt'))
    checks = ('authentication', 'permissions', 'affectedWorkflows', 'visibleUi')
    if state['enableB2b']:
        checks += ('b2bPortal',)
    release.require(all(value.get('checks', {}).get(key) is True for key in checks), 'Functional acceptance is incomplete')
    final = next(p for p in state['completed'] if p['phase'] == 'final-web')
    release.require(validated >= release.parse_time(final['observedAt']), 'Acceptance predates final candidate deployment')
    return {'path': str(path.absolute()), 'sha256': release.digest_file(path), 'validatedAt': value['validatedAt']}


def check_phase(args, state, directory):
    next_phase(state, args.phase)
    live = check_current(state)
    acceptance = acceptance_receipt(args.acceptance_receipt, state) if args.phase.startswith('promote-') else None
    name, spec = planned_spec(args.phase, state, live)
    spec_path = directory / (args.phase + '-spec.json')
    release.private_json(spec_path, spec)
    plan = {'phase': args.phase, 'service': name, 'spec': spec, 'specFileSha256': release.digest_file(spec_path),
            'stateSha256': release.digest_file(directory / 'state.json'), 'acceptanceReceipt': acceptance,
            'checkedAt': release.timestamp()}
    release.private_json(directory / (args.phase + '-plan.json'), plan)
    return {'mode': 'plan-only', 'phase': args.phase, 'service': name, 'immutableImage': release.image_of(spec),
            'checkedAt': plan['checkedAt'], 'spec': str(spec_path), 'specSha256': plan['specFileSha256'],
            'cloudMutationExecuted': False, 'requiresImmediateExternalExecutionAndRecordPhase': True,
            'proposedCommand': shlex.join(['gcloud', 'run', 'services', 'replace', str(spec_path),
                                          '--project=' + release.PROJECT, '--region=' + release.REGION, '--quiet'])}


def record_phase(args, state, directory):
    next_phase(state, args.phase)
    source_receipts(state)
    plan = release.private_read(directory / (args.phase + '-plan.json'))
    release.require(plan['phase'] == args.phase and plan['service'] in release.DEV and
                    plan['stateSha256'] == release.digest_file(directory / 'state.json'), 'Phase plan is stale')
    spec_path = directory / (args.phase + '-spec.json')
    release.require(plan['specFileSha256'] == release.digest_file(spec_path) and
                    release.private_read(spec_path) == plan['spec'], 'Phase spec changed after review')
    if plan['acceptanceReceipt']:
        recorded = plan['acceptanceReceipt']
        release.require(acceptance_receipt(Path(recorded['path']), state) == recorded, 'Acceptance receipt changed')
    live = release.snapshot_all()
    name, spec = plan['service'], plan['spec']
    for service in release.DEV + release.PROTECTED:
        if service != name:
            release.require(release.identity(live[service]) == release.identity(state['expected'][service]),
                            service + ': unrelated cloud state changed')
    release.guards(live[name])
    release.require(release.ready(live[name]) and release.fingerprint(live[name]) == release.fingerprint(spec) and
                    live[name]['metadata']['uid'] == state['expected'][name]['metadata']['uid'],
                    'Observed cloud result differs from the reviewed Ready spec')
    expected_active = sorted([i.get('revisionName'), i['percent']]
                             for i in spec['spec']['traffic'] if i.get('percent', 0))
    release.require(release.active(live[name]) == expected_active, 'Observed traffic differs from phase plan')
    revision_name = (state['expected'][name]['status']['latestReadyRevisionName'] if args.phase.startswith('promote-')
                     else state['revisions'][args.phase])
    release.require(live[name]['status'].get('latestReadyRevisionName') == revision_name and
                    live[name]['status'].get('latestCreatedRevisionName') == revision_name,
                    'Unexpected/unready concurrent candidate; do not record this phase')
    revision = release.cloud('revision', revision_name)
    release.require(release.ready(revision) and revision['status'].get('imageDigest') == state['images'][name],
                    'Observed revision digest differs from the built image')
    for entry in spec['spec']['traffic']:
        if entry.get('tag') in state['tags'].values():
            actual = [t for t in live[name]['status']['traffic'] if t.get('tag') == entry['tag']]
            release.require(len(actual) == 1 and actual[0].get('revisionName') == entry['revisionName'] and
                            actual[0].get('url') == release.tagged_url(state['urls'][name], entry['tag']),
                            'Observed candidate tag/URL differs from plan')
    state['expected'] = live
    observed = {'phase': args.phase, 'observedAt': release.timestamp(), 'service': name,
                'revision': revision_name, 'image': state['images'][name],
                'specSha256': release.fingerprint(live[name]), 'acceptanceReceipt': plan['acceptanceReceipt']}
    state['completed'].append(observed)
    release.private_json(directory / 'state.json', state)
    release.private_json(directory / (args.phase + '-receipt.json'), observed)
    return {'mode': 'read-only-observation', 'recorded': observed, 'cloudMutationExecuted': False}


def verify(state, directory):
    release.require([p['phase'] for p in state['completed']] == list(PHASES), 'Release phases are incomplete')
    live = check_current(state)
    for name, phase in ((release.API, 'candidate-api'), (release.WEB, 'final-web')):
        release.require(release.active(live[name]) == [[state['revisions'][phase], 100]] and
                        release.image_of(live[name]) == state['images'][name], 'Final traffic/image mismatch')
        for tag, revision in release.tags(state['baseline'][name]).items():
            release.require(release.tags(live[name]).get(tag) == revision, 'An original tag is missing')
    env = release.env_map(live[release.WEB])
    release.require(env['API_URL']['value'] == state['urls'][release.API] + '/api/v1' and
                    env['WS_URL']['value'] == state['urls'][release.API], 'Final web is not using stable API')
    result = {'verifiedAt': release.timestamp(), 'sourceSha': state['sourceSha'], 'buildId': state['buildId'],
              'images': state['images'], 'active': {s: release.active(live[s]) for s in release.DEV},
              'migrationReceipt': state['migrationReceipt'], 'productionAndWmsUnchanged': True,
              'scope': 'Cloud metadata and separate receipts; no automatic functional acceptance'}
    release.private_json(directory / 'verify.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode', choices=('init', 'check-phase', 'record-phase', 'verify'))
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--context-dir', type=Path)
    parser.add_argument('--build-id')
    parser.add_argument('--migration-receipt', type=Path)
    parser.add_argument('--enable-b2b', action='store_true')
    parser.add_argument('--phase', choices=PHASES)
    parser.add_argument('--acceptance-receipt', type=Path)
    args = parser.parse_args()
    release.require((args.mode in ('check-phase', 'record-phase')) == bool(args.phase), 'Phase argument mismatch')
    release.require(args.mode == 'init' or not (args.context_dir or args.build_id or args.migration_receipt or args.enable_b2b),
                    'Build/migration/B2B arguments are for init only')
    release.require(not args.acceptance_receipt or (args.mode == 'check-phase' and args.phase.startswith('promote-')),
                    'Acceptance argument is for promotion preflight only')
    directory = release.private_directory(args.state_dir, new=args.mode == 'init')
    fd = os.open(directory / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.mode == 'init':
            result = initialize(args, directory)
        else:
            state = release.private_read(directory / 'state.json')
            release.require(state.get('version') == 1 and state.get('project') == release.PROJECT and
                            state.get('region') == release.REGION, 'Wrong release state environment')
            if args.mode == 'verify':
                result = verify(state, directory)
            elif args.mode == 'check-phase':
                result = check_phase(args, state, directory)
            else:
                result = record_phase(args, state, directory)
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, StopIteration) as error:
        raise SystemExit('STOP: ' + str(error))
