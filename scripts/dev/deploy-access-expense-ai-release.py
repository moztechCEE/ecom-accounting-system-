#!/usr/bin/env python3
"""Reviewed ERP DEV candidate/traffic helper; default is PLAN ONLY.

Never builds, migrates, changes IAM, reads secret payloads, or modifies production.
Only --execute applies a prepared phase, after a fresh cloud-state comparison.
Do not run the printed gcloud command directly: use this helper's --execute so
the stale-state checks and receipt are retained. Keep the state directory private.

Workflow:
  init --state-dir DIR --build-id BUILD --source-sha FULL_SHA
  candidate-api --state-dir DIR [--execute]
  candidate-web --state-dir DIR [--execute]
  final-web --state-dir DIR [--execute]
  promote-api --state-dir DIR [--execute]   # only after candidate acceptance
  promote-web --state-dir DIR [--execute]
  verify --state-dir DIR

Run each phase once without --execute to review its proposed spec/command.
Candidate web uses tagged API; final web uses stable API. Both web tags are
included in the API's finite CORS allowlist. Existing tags are never removed.
Before candidate-api, independently review the DEV migrations and grant the DEV
runtime service account accessor on ecom-accounting-gemini-api-key only.
An interrupted/ambiguous mutation leaves pending.json. Use the same phase with
--reconcile to accept ONLY its exact ready result; this option never mutates cloud.
"""
import argparse
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
from urllib.parse import urlsplit

PROJECT = 'moztech-main-db'
REGION = 'asia-east1'
API = 'corely-erp-api-dev'
WEB = 'corely-erp-dev'
DEV = (API, WEB)
PROTECTED = ('ecom-accounting-backend', 'ecom-accounting-frontend', 'corely-wms', 'corely-wms-dev')
REGISTRY = f'{REGION}-docker.pkg.dev/{PROJECT}/cloud-run/'
BASE_REVISIONS = {s: s + '-account-sso2-0923' for s in DEV}
BASE_IMAGES = {
    API: REGISTRY + API + '@sha256:7de1f261014cfe50d6c85e41dba6733b906fb1c38c9eab657df3f5f6e95680c8',
    WEB: REGISTRY + WEB + '@sha256:d5b12ba596235b08df9ee695009e6c4a08eb56984628a329a2e7de4732a00102',
}
PHASES = ('candidate-api', 'candidate-web', 'final-web', 'promote-api', 'promote-web')
VOLATILE_ANNOTATIONS = {'run.googleapis.com/operation-id', 'run.googleapis.com/urls',
                        'run.googleapis.com/ingress-status', 'serving.knative.dev/creator',
                        'serving.knative.dev/lastModifier', 'run.googleapis.com/client-name',
                        'run.googleapis.com/client-version'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def read_cloud(*args):
    # This path only accepts the explicitly named read operations below.
    require(args[:3] in [('run', 'services', 'describe'), ('run', 'revisions', 'describe')]
            or args[:2] == ('builds', 'describe'), 'Unapproved cloud read')
    command = ['gcloud', *args, '--project=' + PROJECT, '--format=json']
    result = subprocess.run(command, text=True, capture_output=True)
    require(result.returncode == 0, 'Cloud read failed: ' + shlex.join(command))
    return json.loads(result.stdout)


def service(name):
    require(name in DEV + PROTECTED, 'Service is outside the fixed read allowlist')
    return read_cloud('run', 'services', 'describe', name, '--region=' + REGION)


def ready(value):
    return any(c.get('type') == 'Ready' and c.get('status') == 'True'
               for c in value.get('status', {}).get('conditions', []))


def active(value):
    return sorted([item.get('revisionName'), item['percent']]
                  for item in value['status'].get('traffic', []) if item.get('percent', 0))


def tags(value):
    traffic = value['spec'].get('traffic', [])
    result = {i['tag']: i.get('revisionName') for i in traffic if i.get('tag')}
    require(len(result) == sum(bool(i.get('tag')) for i in traffic), 'Duplicate traffic tags')
    return result


def portable(value):
    """Preserve all user config; discard server-generated metadata only."""
    result = copy.deepcopy(value)
    result.pop('status', None)
    meta = result['metadata']
    result['metadata'] = {k: v for k, v in meta.items()
                          if k in ('name', 'namespace', 'labels', 'annotations')}
    for metadata in (result['metadata'], result['spec']['template'].get('metadata', {})):
        for key in VOLATILE_ANNOTATIONS:
            metadata.get('annotations', {}).pop(key, None)
        metadata.get('labels', {}).pop('client.knative.dev/nonce', None)
    return result


def fingerprint(value):
    result = portable(value)
    traffic = result['spec'].get('traffic', [])
    for entry in traffic:
        entry.pop('url', None)
        if not entry.get('percent'):
            entry.pop('percent', None)
    result['spec']['traffic'] = sorted(traffic, key=lambda x: json.dumps(x, sort_keys=True))
    return hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()


def protection(value):
    # Any protected config or routing change requires renewed coordination.
    return {'config': fingerprint(value), 'active': active(value),
            'uid': value['metadata'].get('uid')}


def env_map(value):
    containers = value['spec']['template']['spec']['containers']
    require(len(containers) == 1, 'Unexpected multi-container service; review manually')
    entries = containers[0].get('env', [])
    result = {e['name']: e for e in entries}
    require(len(result) == len(entries), 'Duplicate environment variables')
    return result


def set_env(value, name, content):
    entries = value['spec']['template']['spec']['containers'][0].setdefault('env', [])
    replacement = {'name': name, **content}
    for i, entry in enumerate(entries):
        if entry['name'] == name:
            entries[i] = replacement
            return
    entries.append(replacement)


def image_of(value):
    return value['spec']['template']['spec']['containers'][0]['image']


def assert_dev_guards(value):
    name = value['metadata']['name']
    require(name in DEV, 'Refusing non-DEV service mutation')
    require(value['metadata'].get('namespace') == '249593319772', 'Unexpected project namespace')
    require(value['metadata'].get('labels', {}).get('environment') == 'dev', 'Missing DEV label')
    env = env_map(value)
    required = ({'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921',
                 'DB_USER': 'erp_dev_runtime', 'SEED_ON_STARTUP': 'false',
                 'RUNTIME_SCHEDULES_ENABLED': 'false', 'WMS_PORTAL_SSO_ENABLED': 'true'}
                if name == API else {'ERP_DEV_ENVIRONMENT': 'true'})
    for key, expected in required.items():
        require(env.get(key, {}).get('value') == expected, 'DEV/SSO guard changed: ' + key)
    account = ('corely-erp-dev-rt' if name == API else 'corely-erp-dev-web')
    require(value['spec']['template']['spec'].get('serviceAccountName') ==
            account + '@' + PROJECT + '.iam.gserviceaccount.com', 'Unexpected runtime service account')


def private_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    fd = os.open(temporary, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def tagged_url(stable, tag):
    parsed = urlsplit(stable)
    require(parsed.scheme == 'https' and parsed.hostname and parsed.hostname.endswith('.run.app')
            and parsed.path in ('', '/') and not parsed.query and not parsed.fragment,
            'Unexpected stable Cloud Run URL')
    return 'https://' + tag + '---' + parsed.hostname


def resolve_build(build_id, source):
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'Use the reviewed full 40-character source SHA')
    require(re.fullmatch(r'[0-9a-f-]{36}', build_id), 'Unexpected Cloud Build ID')
    build = read_cloud('builds', 'describe', build_id)
    require(build.get('status') == 'SUCCESS', 'Cloud Build is not SUCCESS')
    result = {}
    for name in DEV:
        expected = REGISTRY + name + ':access-expense-ai-' + source
        matches = [i for i in build.get('results', {}).get('images', []) if i.get('name') == expected]
        require(len(matches) == 1 and re.fullmatch(r'sha256:[0-9a-f]{64}', matches[0].get('digest', '')),
                'Build must contain one immutable result for ' + expected)
        result[name] = REGISTRY + name + '@' + matches[0]['digest']
    require(set(build.get('images', [])) ==
            {REGISTRY + s + ':access-expense-ai-' + source for s in DEV},
            'Build output includes an unreviewed image target')
    return result


def snapshot_all():
    return {name: service(name) for name in DEV + PROTECTED}


def assert_active(live, api_revision, web_revision):
    for name, revision in ((API, api_revision), (WEB, web_revision)):
        require(active(live[name]) == [[revision, 100]], name + ': unexpected active traffic')


def check_current(state):
    live = snapshot_all()
    for name in PROTECTED:
        require(protection(live[name]) == state['protected'][name], name + ': protected state changed; stop')
    for name in DEV:
        assert_dev_guards(live[name])
        require(ready(live[name]), name + ': service is not Ready')
        require(live[name]['metadata'].get('uid') == state['uids'][name], name + ': service was replaced')
        require(fingerprint(live[name]) == fingerprint(state['expected'][name]),
                name + ': stale service configuration; coordinate before proceeding')
        require(active(live[name]) == active(state['expected'][name]), name + ': stale traffic')
    return live


def initialize(args, directory):
    require(not (directory / 'state.json').exists(), 'State already exists; refusing reinitialization')
    require(args.build_id and args.source_sha, 'init requires --build-id and --source-sha')
    images = resolve_build(args.build_id, args.source_sha)
    previous = None
    if args.previous_state_dir:
        previous_dir = args.previous_state_dir.expanduser().resolve()
        require(not (previous_dir / 'pending.json').exists(), 'Previous release has an unresolved mutation')
        previous = json.loads((previous_dir / 'state.json').read_text())
        require(previous.get('version') == 1 and previous.get('project') == PROJECT
                and previous.get('region') == REGION, 'Previous release belongs to another environment')
        require([p.get('phase') for p in previous.get('completed', [])] == ['candidate-api', 'candidate-web'],
                'Previous release must contain only the two candidates, before final web or promotion')
        live = check_current(previous)
        for name in DEV:
            recorded = previous['expected'][name]
            require(live[name]['spec'] == recorded['spec'], name + ': previous candidate spec changed')
            for field in ('latestReadyRevisionName', 'latestCreatedRevisionName'):
                require(live[name]['status'].get(field) == recorded['status'].get(field),
                        name + ': previous candidate ' + field + ' changed')
    else:
        live = snapshot_all()
    assert_active(live, BASE_REVISIONS[API], BASE_REVISIONS[WEB])
    for name in DEV:
        assert_dev_guards(live[name])
        require(ready(live[name]), name + ': service is not Ready')
        if previous:
            revision = read_cloud('run', 'revisions', 'describe', BASE_REVISIONS[name], '--region=' + REGION)
            require(ready(revision) and revision['status'].get('imageDigest') == BASE_IMAGES[name],
                    name + ': original SSO2 revision/image changed')
        else:
            require(live[name]['status'].get('latestReadyRevisionName') == BASE_REVISIONS[name]
                    and image_of(live[name]) == BASE_IMAGES[name], name + ': reviewed SSO2 baseline changed')
    suffix = 'aex-' + args.source_sha[:8]
    candidate_tag, final_tag = suffix + '-candidate', suffix + '-final'
    for name in DEV:
        require(not ({candidate_tag, final_tag} & set(tags(live[name]))), 'Release tag already exists')
    state = {'version': 1, 'createdAt': timestamp(), 'project': PROJECT, 'region': REGION,
             'sourceSha': args.source_sha, 'buildId': args.build_id, 'images': images,
             'previousCandidateSource': previous['sourceSha'] if previous else None,
             'rollbackRevisions': BASE_REVISIONS,
             'baseline': {s: live[s] for s in DEV}, 'expected': {s: live[s] for s in DEV},
             'uids': {s: live[s]['metadata']['uid'] for s in DEV},
             'protected': {s: protection(live[s]) for s in PROTECTED},
             'tags': {'candidate': candidate_tag, 'final': final_tag},
             'revisions': {'candidate-api': API + '-' + suffix + '-c',
                           'candidate-web': WEB + '-' + suffix + '-c',
                           'final-web': WEB + '-' + suffix + '-f'},
             'urls': {s: live[s]['status']['url'] for s in DEV}, 'completed': []}
    for value in state['revisions'].values():
        require(len(value) <= 63, 'Revision name too long')
    state['urls']['candidate-api'] = tagged_url(state['urls'][API], candidate_tag)
    state['urls']['candidate-web'] = tagged_url(state['urls'][WEB], candidate_tag)
    state['urls']['final-web'] = tagged_url(state['urls'][WEB], final_tag)
    private_json(directory / 'state.json', state)
    print(json.dumps({'initialized': str(directory), 'sourceSha': args.source_sha,
                      'buildId': args.build_id, 'images': images, 'urls': state['urls']}, indent=2))


def planned_spec(phase, state, live):
    name = API if phase in ('candidate-api', 'promote-api') else WEB
    result = portable(live[name])
    if phase.startswith('promote-'):
        revision = state['revisions']['candidate-api' if name == API else 'final-web']
        result['spec']['traffic'] = [{k: v for k, v in t.items() if k != 'percent'}
                                     for t in result['spec'].get('traffic', []) if t.get('tag')]
        result['spec']['traffic'].append({'revisionName': revision, 'percent': 100})
    else:
        revision = state['revisions'][phase]
        result['spec']['template'].setdefault('metadata', {})['name'] = revision
        result['spec']['template']['spec']['containers'][0]['image'] = state['images'][name]
        if name == API:
            set_env(result, 'ERP_DEV_AI_ENABLED', {'value': 'true'})
            set_env(result, 'GEMINI_API_KEY', {'valueFrom': {'secretKeyRef': {
                'name': 'ecom-accounting-gemini-api-key', 'key': '1'}}})
            origins = env_map(result).get('CORS_ORIGIN', {}).get('value', '').split(',')
            origins = list(dict.fromkeys(o.strip() for o in origins if o.strip()))
            require(origins and '*' not in origins, 'CORS must retain an explicit origin allowlist')
            for origin in (state['urls']['candidate-web'], state['urls']['final-web']):
                if origin not in origins:
                    origins.append(origin)
            set_env(result, 'CORS_ORIGIN', {'value': ','.join(origins)})
        else:
            api = state['urls']['candidate-api'] if phase == 'candidate-web' else state['urls'][API]
            set_env(result, 'API_URL', {'value': api + '/api/v1'})
            set_env(result, 'WS_URL', {'value': api})
        tag = state['tags']['final' if phase == 'final-web' else 'candidate']
        require(tag not in tags(result), 'Refusing to overwrite an existing tag')
        # Explicit old revision weights implement --no-traffic even when latest changes.
        for item in result['spec']['traffic']:
            require(not item.get('latestRevision'), 'Implicit latest routing needs manual review')
        result['spec']['traffic'].append({'revisionName': revision, 'tag': tag})
    assert_dev_guards(result)
    require(sum(i.get('percent', 0) for i in result['spec']['traffic']) == 100, 'Traffic must total 100')
    for tag, target in tags(live[name]).items():
        require(tags(result).get(tag) == target, 'Existing tag changed')
    old_env, new_env = env_map(live[name]), env_map(result)
    allowed = {'ERP_DEV_AI_ENABLED', 'GEMINI_API_KEY', 'CORS_ORIGIN'} if name == API else {'API_URL', 'WS_URL'}
    for key, value in old_env.items():
        require(key in allowed or new_env.get(key) == value, 'Unrelated environment value changed: ' + key)
    return name, result


def accept_result(directory, state, pending):
    name, phase, spec = pending['service'], pending['phase'], pending['spec']
    live = snapshot_all()
    for protected in PROTECTED:
        require(protection(live[protected]) == state['protected'][protected], protected + ': protected state changed')
    for dev in DEV:
        assert_dev_guards(live[dev])
        require(ready(live[dev]), dev + ': pending result is not Ready')
        target = spec if dev == name else state['expected'][dev]
        require(fingerprint(live[dev]) == fingerprint(target), dev + ': result differs from proposed spec')
        require(live[dev]['metadata'].get('uid') == state['uids'][dev], dev + ': identity changed')
    expected_api = state['revisions']['candidate-api'] if phase in ('promote-api', 'promote-web') else BASE_REVISIONS[API]
    expected_web = state['revisions']['final-web'] if phase == 'promote-web' else BASE_REVISIONS[WEB]
    assert_active(live, expected_api, expected_web)
    if not phase.startswith('promote-'):
        revision_name = state['revisions'][phase]
        require(live[name]['status'].get('latestReadyRevisionName') == revision_name,
                'Candidate revision is not latest Ready')
        revision = read_cloud('run', 'revisions', 'describe', revision_name, '--region=' + REGION)
        require(ready(revision) and revision['status'].get('imageDigest') == state['images'][name],
                'Candidate Ready/image digest verification failed')
        tag = state['tags']['final' if phase == 'final-web' else 'candidate']
        routes = [t for t in live[name]['status']['traffic'] if t.get('tag') == tag]
        require(len(routes) == 1 and routes[0].get('url') == state['urls'][phase],
                'Candidate URL differs from the reviewed CORS/runtime URL')
    state['expected'] = {s: live[s] for s in DEV}
    state['completed'].append({'phase': phase, 'at': timestamp(), 'revision':
                               state['revisions'].get(phase), 'active': {s: active(live[s]) for s in DEV}})
    private_json(directory / (phase + '-receipt.json'), state['completed'][-1])
    private_json(directory / 'state.json', state)
    (directory / 'pending.json').unlink()
    print(json.dumps({'completed': phase, 'active': {s: active(live[s]) for s in DEV},
                      'productionAndWmsUnchanged': True}, indent=2))


def run_phase(args, directory, state):
    require(state.get('project') == PROJECT and state.get('region') == REGION and state.get('version') == 1,
            'State belongs to an unsupported release')
    pending_path = directory / 'pending.json'
    if args.reconcile:
        require(not args.execute and pending_path.exists(), '--reconcile requires a pending phase and no --execute')
        pending = json.loads(pending_path.read_text())
        require(pending['phase'] == args.phase and pending['service'] in DEV, 'Wrong pending phase')
        accept_result(directory, state, pending)
        return
    require(not pending_path.exists(), 'Pending mutation exists; inspect and use the same phase --reconcile')
    live = check_current(state)
    done = [p['phase'] for p in state['completed']]
    require(done == list(PHASES[:len(done)]), 'Invalid phase history')
    if args.phase == 'verify':
        require(done == list(PHASES), 'Release is incomplete')
        assert_active(live, state['revisions']['candidate-api'], state['revisions']['final-web'])
        for name in DEV:
            require(image_of(live[name]) == state['images'][name], 'Final image mismatch')
            for tag, revision in tags(state['baseline'][name]).items():
                require(tags(live[name]).get(tag) == revision, 'Original tag missing')
        env = env_map(live[WEB])
        require(env['API_URL']['value'] == state['urls'][API] + '/api/v1' and
                env['WS_URL']['value'] == state['urls'][API], 'Final web remains pinned to a candidate API')
        result = {'verifiedAt': timestamp(), 'sourceSha': state['sourceSha'], 'buildId': state['buildId'],
                  'active': {s: active(live[s]) for s in DEV}, 'images': state['images'],
                  'productionAndWmsUnchanged': True, 'scope': 'Cloud configuration only; functional QA is separate'}
        private_json(directory / 'verify.json', result)
        print(json.dumps(result, indent=2))
        return
    require(len(done) < len(PHASES) and args.phase == PHASES[len(done)],
            'Run phases in order; next phase is ' + (PHASES[len(done)] if len(done) < len(PHASES) else 'verify'))
    if args.phase == 'promote-web':
        assert_active(live, state['revisions']['candidate-api'], BASE_REVISIONS[WEB])
    else:
        assert_active(live, BASE_REVISIONS[API], BASE_REVISIONS[WEB])
    name, spec = planned_spec(args.phase, state, live)
    path = directory / (args.phase + '-spec.json')
    private_json(path, spec)
    command = ['gcloud', 'run', 'services', 'replace', str(path), '--project=' + PROJECT,
               '--region=' + REGION, '--quiet']
    print(json.dumps({'phase': args.phase, 'mode': 'execute' if args.execute else 'plan-only',
                      'service': name, 'spec': str(path), 'command': shlex.join(command),
                      'urls': state['urls'], 'immutableImage': image_of(spec)}, indent=2), flush=True)
    if not args.execute:
        return
    # Recheck immediately before the only cloud mutation call; never accepts arbitrary commands/services.
    second = check_current(state)
    require(all(fingerprint(second[s]) == fingerprint(live[s]) for s in DEV), 'Cloud changed while preparing')
    require(name in DEV and spec['metadata']['name'] == name, 'Mutation outside the DEV allowlist')
    private_json(directory / 'pending.json', {'phase': args.phase, 'service': name,
                                              'spec': spec, 'requestedAt': timestamp()})
    result = subprocess.run(command, text=True, capture_output=True)
    # Raw gcloud output is deliberately not echoed: deployment output can contain env data.
    require(result.returncode == 0, 'Cloud mutation failed/ambiguous; inspect Cloud Run then use --reconcile only if exact result is Ready')
    accept_result(directory, state, json.loads((directory / 'pending.json').read_text()))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('phase', choices=('init', *PHASES, 'verify'))
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--build-id')
    parser.add_argument('--source-sha')
    parser.add_argument('--previous-state-dir', type=Path, help='init only: replace recorded zero-traffic candidates while SSO2 remains at 100%%')
    parser.add_argument('--execute', action='store_true', help='Apply this DEV-only phase after fresh guards')
    parser.add_argument('--reconcile', action='store_true', help='Read-only recovery of the exact pending result')
    args = parser.parse_args()
    require(not args.previous_state_dir or args.phase == 'init', '--previous-state-dir is for init only')
    require(not (args.phase in ('init', 'verify') and (args.execute or args.reconcile)),
            'init/verify are read-only; do not pass execute/reconcile')
    directory = args.state_dir.expanduser().absolute()
    require(not directory.is_symlink(), 'State directory must not be a symlink')
    if args.phase == 'init':
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(directory.is_dir() and directory.stat().st_uid == os.getuid()
            and directory.stat().st_mode & 0o077 == 0, 'State directory must exist, be yours, and have mode 700')
    fd = os.open(directory / '.lock', os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase == 'init':
            initialize(args, directory)
        else:
            state = json.loads((directory / 'state.json').read_text())
            run_phase(args, directory, state)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(1)
