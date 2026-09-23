"""Shared, DEV-only release guards. Cloud access in this module is read-only.

Snapshots contain configuration and secret references, never secret payloads.
Keep generated contexts/receipts private. No caller may supply a project, region,
service allowlist, cloud command, or alternative migration checksum.
"""
import copy
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'moztech-main-db'
REGION = 'asia-east1'
BUILD_REGION = 'global'
API = 'corely-erp-api-dev'
WEB = 'corely-erp-dev'
DEV = (API, WEB)
PROTECTED = ('ecom-accounting-backend', 'ecom-accounting-frontend', 'corely-wms', 'corely-wms-dev')
REGISTRY = f'{REGION}-docker.pkg.dev/{PROJECT}/cloud-run/'
UNCHANGED_RUNTIME = (
    'backend/package.json', 'backend/package-lock.json', 'frontend/package.json',
    'frontend/package-lock.json', 'backend/Dockerfile', 'frontend/Dockerfile',
    'backend/scripts/start-prod.js', 'backend/scripts/database-url.js',
    'backend/prisma.config.ts', 'frontend/server.mjs', 'backend/assets',
)
MIGRATIONS = {
    '20260923080000_b2b_customer_portal': 'fd62bc6551f91b6e3adf015a8ad264bb51dd50c8df630aa7efb4ababdc2adbfb',
    '20260923090000_purchase_landed_cost': 'faf701d2fa723bd742c215aca17c195e009be02a6d32ef6a555b713f45993b69',
    '20260923100000_wms_handover_reconciliation': 'd1229da385b8e196265c513a06ffde18eceaafe4971d1e4dfc4c0c46413a9114',
}
# Enabling either direction is a separate integration release with key/grant QA.
DISABLED_FLAGS = ('WMS_WORKSPACE_READ_ENABLED', 'WMS_WORKSPACE_COMMANDS_ENABLED', 'WMS_HANDOVER_ENABLED')
VOLATILE_ANNOTATIONS = {
    'run.googleapis.com/operation-id', 'run.googleapis.com/urls',
    'run.googleapis.com/ingress-status', 'serving.knative.dev/creator',
    'serving.knative.dev/lastModifier', 'run.googleapis.com/client-name',
    'run.googleapis.com/client-version',
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest_file(path):
    require(path.is_file() and not path.is_symlink(), 'Missing file or symlink: ' + str(path))
    return digest_bytes(path.read_bytes())


def digest_json(value):
    return digest_bytes(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def git(*args):
    result = subprocess.run(['git', *args], cwd=ROOT, text=True, capture_output=True)
    require(result.returncode == 0, 'Git verification failed: ' + ' '.join(args))
    return result.stdout.strip()


def clean_source():
    require(not git('status', '--porcelain'), 'Commit reviewed source first; checkout must be clean')
    source = git('rev-parse', 'HEAD')
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'Expected full source SHA')
    return source


def verify_source(source, live_source):
    require(re.fullmatch(r'[0-9a-f]{40}', source or '') and
            re.fullmatch(r'[0-9a-f]{40}', live_source or ''), 'Use full 40-character source SHAs')
    require(git('rev-parse', live_source + '^{commit}') == live_source, 'Live source commit is unavailable')
    result = subprocess.run(['git', 'merge-base', '--is-ancestor', live_source, source], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    require(result.returncode == 0, 'Current source must include the currently serving DEV source')
    require(not git('diff', '--name-only', live_source, source, '--', *UNCHANGED_RUNTIME),
            'Dependencies/startup/assets/server changed; immutable overlay needs a separately reviewed full build')
    # Reject additional schema migrations instead of silently including another release.
    changed = git('diff', '--name-status', live_source, source, '--', 'backend/prisma/migrations')
    for line in changed.splitlines():
        parts = line.split('\t')
        require(len(parts) == 2 and parts[0] == 'A', 'Existing migration was changed; stop for review')
        name = Path(parts[1]).parent.name
        require(name in MIGRATIONS and parts[1] == f'backend/prisma/migrations/{name}/migration.sql',
                'Unreviewed migration in overlay: ' + parts[1])
    for name, checksum in MIGRATIONS.items():
        require(digest_file(ROOT / 'backend/prisma/migrations' / name / 'migration.sql') == checksum,
                'Reviewed migration checksum changed: ' + name)


def cloud(kind, target):
    """The only gcloud entry point; no mutations or secret access exist here."""
    if kind == 'service':
        require(target in DEV + PROTECTED, 'Service is outside read allowlist')
        args = ['run', 'services', 'describe', target, '--region=' + REGION]
    elif kind == 'revision':
        require(any(target.startswith(s + '-') for s in DEV) and
                re.fullmatch(r'[a-z0-9-]{1,63}', target), 'Revision is outside DEV allowlist')
        args = ['run', 'revisions', 'describe', target, '--region=' + REGION]
    elif kind == 'build':
        require(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', target or ''),
                'Expected Cloud Build UUID')
        args = ['builds', 'describe', target, '--region=' + BUILD_REGION]
    else:
        raise RuntimeError('Cloud operation is outside read allowlist')
    result = subprocess.run(['gcloud', *args, '--project=' + PROJECT, '--format=json'],
                            text=True, capture_output=True)
    require(result.returncode == 0, 'Cloud metadata read failed; credential-bearing output suppressed')
    return json.loads(result.stdout)


def ready(value):
    return any(c.get('type') == 'Ready' and c.get('status') == 'True'
               for c in value.get('status', {}).get('conditions', []))


def active(value):
    return sorted([item.get('revisionName'), item['percent']]
                  for item in value['status'].get('traffic', []) if item.get('percent', 0))


def tags(value):
    entries = value['spec'].get('traffic', [])
    result = {i['tag']: i.get('revisionName') for i in entries if i.get('tag')}
    require(len(result) == sum(bool(i.get('tag')) for i in entries), 'Duplicate traffic tags')
    return result


def portable(value):
    result = copy.deepcopy(value)
    result.pop('status', None)
    result['metadata'] = {k: v for k, v in result['metadata'].items()
                          if k in ('name', 'namespace', 'labels', 'annotations')}
    for metadata in (result['metadata'], result['spec']['template'].get('metadata', {})):
        for key in VOLATILE_ANNOTATIONS:
            metadata.get('annotations', {}).pop(key, None)
        metadata.get('labels', {}).pop('client.knative.dev/nonce', None)
    return result


def fingerprint(value):
    result = portable(value)
    entries = result['spec'].get('traffic', [])
    for entry in entries:
        entry.pop('url', None)
        if not entry.get('percent'):
            entry.pop('percent', None)
    result['spec']['traffic'] = sorted(entries, key=lambda item: json.dumps(item, sort_keys=True))
    return digest_json(result)


def identity(value):
    return {'config': fingerprint(value), 'active': active(value),
            'uid': value['metadata'].get('uid'), 'generation': value['metadata'].get('generation'),
            'latestReady': value['status'].get('latestReadyRevisionName'),
            'latestCreated': value['status'].get('latestCreatedRevisionName')}


def env_map(value):
    containers = value['spec']['template']['spec']['containers']
    require(len(containers) == 1, 'Multi-container service needs separate review')
    entries = containers[0].get('env', [])
    result = {e['name']: e for e in entries}
    require(len(entries) == len(result), 'Duplicate environment variables')
    return result


def set_env(value, name, text):
    entries = value['spec']['template']['spec']['containers'][0].setdefault('env', [])
    replacement = {'name': name, 'value': text}
    for i, entry in enumerate(entries):
        if entry['name'] == name:
            entries[i] = replacement
            return
    entries.append(replacement)


def image_of(value):
    return value['spec']['template']['spec']['containers'][0]['image']


def guards(value):
    name = value['metadata']['name']
    require(name in DEV, 'Refusing a non-DEV mutation plan')
    require(value['metadata'].get('namespace') == '249593319772', 'Unexpected project namespace')
    require(value['metadata'].get('labels', {}).get('environment') == 'dev', 'Missing DEV label')
    env = env_map(value)
    required = ({'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921',
                 'DB_USER': 'erp_dev_runtime', 'SEED_ON_STARTUP': 'false',
                 'RUNTIME_SCHEDULES_ENABLED': 'false', 'WMS_PORTAL_SSO_ENABLED': 'true'}
                if name == API else {'ERP_DEV_ENVIRONMENT': 'true', 'STAGED_OPERATIONS_ENABLED': 'false'})
    for key, expected in required.items():
        require(env.get(key, {}).get('value') == expected, 'DEV protection changed: ' + key)
    if name == API:
        for key in DISABLED_FLAGS:
            require(key not in env or env[key].get('value') == 'false',
                    'WMS integration must remain disabled in this release: ' + key)
    account = ('corely-erp-dev-rt' if name == API else 'corely-erp-dev-web')
    require(value['spec']['template']['spec'].get('serviceAccountName') ==
            account + '@' + PROJECT + '.iam.gserviceaccount.com', 'Unexpected DEV runtime service account')


def snapshot_all():
    return {name: cloud('service', name) for name in DEV + PROTECTED}


def build_images(build, source, historical=False):
    require(build.get('status') == 'SUCCESS', 'Cloud Build is not SUCCESS')
    result = {}
    names = []
    for service in DEV:
        matches = [item for item in build.get('results', {}).get('images', [])
                   if item.get('name', '').startswith(REGISTRY + service + ':')]
        require(len(matches) == 1, 'Build must have one output per DEV service')
        item = matches[0]
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', item.get('digest', '')), 'Build image lacks immutable digest')
        tag = item['name'].split(':')[-1]
        if historical:
            suffix = re.search(r'(?:^|-)([0-9a-f]{12,40})$', tag)
            require(suffix and source.startswith(suffix[1]) and
                    git('rev-parse', suffix[1] + '^{commit}') == source,
                    'Live build tag does not uniquely identify reviewed source SHA')
        else:
            require(tag == 'b2b-handover-' + source, 'Candidate image is for another source')
        result[service] = REGISTRY + service + '@' + item['digest']
        names.append(item['name'])
    require(len(build.get('results', {}).get('images', [])) == len(DEV) and
            sorted(build.get('images', [])) == sorted(names), 'Build has unexpected image outputs')
    return result


def capture_baseline(live_source, live_build_id):
    require(re.fullmatch(r'[0-9a-f]{40}', live_source or ''), 'Use full live source SHA')
    live = snapshot_all()
    revisions, images = {}, {}
    for name in DEV:
        value = live[name]
        guards(value)
        require(ready(value), name + ': service is not Ready')
        traffic = active(value)
        require(len(traffic) == 1 and traffic[0][1] == 100, name + ': expected one 100% active revision')
        revision_name = traffic[0][0]
        require(value['status'].get('latestReadyRevisionName') == revision_name and
                value['status'].get('latestCreatedRevisionName') == revision_name,
                name + ': another candidate exists; coordinate before creating a baseline')
        weights = sorted([i.get('revisionName'), i['percent']]
                         for i in value['spec'].get('traffic', []) if i.get('percent', 0))
        require(weights == traffic and all(not i.get('latestRevision') for i in value['spec'].get('traffic', [])),
                name + ': require explicit active revision routing')
        tags(value)
        revision = cloud('revision', revision_name)
        image = revision.get('status', {}).get('imageDigest', '')
        require(ready(revision) and re.fullmatch(re.escape(REGISTRY + name) + r'@sha256:[0-9a-f]{64}', image),
                name + ': active revision must have a Ready immutable image')
        require(image_of(value) == image, name + ': template image differs from active revision')
        revisions[name], images[name] = revision, image
    proven = build_images(cloud('build', live_build_id), live_source, historical=True)
    require(proven == images, 'Live build does not produce both currently serving immutable images')
    return {'capturedAt': timestamp(), 'liveSourceSha': live_source, 'liveBuildId': live_build_id,
            'sourceEvidence': 'successful-build-source-tags-and-serving-digests',
            'services': live, 'activeRevisions': revisions, 'images': images}


def assert_snapshot(expected, live):
    for name in DEV + PROTECTED:
        require(identity(live[name]) == identity(expected[name]), name + ': cloud state changed; coordinate again')
    for name in DEV:
        guards(live[name])
        require(ready(live[name]), name + ': service is not Ready')


def private_directory(path, new=False):
    path = path.expanduser().absolute()
    require(not path.is_symlink(), 'Private directory cannot be a symlink')
    if new:
        path.mkdir(mode=0o700, parents=True, exist_ok=False)
    require(path.is_dir() and path.stat().st_uid == os.getuid() and path.stat().st_mode & 0o077 == 0,
            'Directory must be private, owned by this user, and mode 700')
    return path


def private_json(path, value):
    require(not path.is_symlink(), 'Cannot write through a symlink')
    tmp = path.with_name(path.name + '.tmp')
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def private_read(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_uid == os.getuid() and
            path.stat().st_mode & 0o077 == 0, 'Receipt/state must be a private owned regular file')
    return json.loads(path.read_text())


def files_manifest(directory):
    result = {}
    for path in sorted(directory.rglob('*')):
        require(not path.is_symlink(), 'Build context cannot contain symlinks')
        if path.is_file() and path != directory / 'manifest.json':
            result[str(path.relative_to(directory))] = digest_file(path)
    return result


def verify_context(context):
    context = private_directory(context)
    manifest = private_read(context / 'manifest.json')
    require(manifest.get('version') == 1 and manifest.get('project') == PROJECT and
            manifest.get('region') == REGION and manifest.get('devOnly') is True, 'Wrong build manifest environment')
    require(files_manifest(context) == manifest.get('filesSha256'), 'Prepared build context changed')
    require(re.fullmatch(r'[0-9a-f]{40}', manifest.get('sourceSha', '')), 'Invalid manifest source SHA')
    require(manifest.get('migrationChecksums') == MIGRATIONS, 'Manifest migration checksums changed')
    expected = [REGISTRY + s + ':b2b-handover-' + manifest['sourceSha'] for s in DEV]
    require(manifest.get('images') == expected, 'Unexpected build image destinations')
    return manifest


def parse_time(value):
    require(isinstance(value, str), 'Missing ISO timestamp')
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(date.tzinfo is not None and date.utcoffset() == timedelta(0), 'Timestamp must be UTC')
    require(date <= datetime.now(timezone.utc) + timedelta(minutes=5), 'Timestamp is in the future')
    return date


def migration_receipt(path, source):
    value = private_read(path)
    expected = {'version': 1, 'project': PROJECT, 'database': 'erp_dev_20260921',
                'dbUser': 'erp_dev_runtime', 'schema': 'public', 'sourceSha': source, 'allApplied': True}
    require(all(value.get(k) == v for k, v in expected.items()), 'Migration receipt environment/source mismatch')
    validated = parse_time(value.get('validatedAt'))
    rows = value.get('migrations', [])
    require(isinstance(rows, list) and len(rows) == len(MIGRATIONS), 'Receipt must cover exactly three reviewed migrations')
    require({r.get('name') for r in rows} == set(MIGRATIONS), 'Receipt migration names differ')
    for row in rows:
        require(row.get('sha256') == MIGRATIONS[row['name']] and row.get('status') == 'applied' and
                row.get('ledgerVerified') is True and row.get('objectsVerified') is True,
                'Migration ledger/objects/checksum not verified: ' + row['name'])
        require(parse_time(row.get('finishedAt')) <= validated, 'Migration finished after receipt validation')
    return {'path': str(path.absolute()), 'sha256': digest_file(path), 'validatedAt': value['validatedAt']}


def tagged_url(stable, tag):
    parsed = urlsplit(stable)
    require(parsed.scheme == 'https' and parsed.hostname and parsed.hostname.endswith('.run.app') and
            not parsed.username and not parsed.port and parsed.path in ('', '/') and
            not parsed.query and not parsed.fragment and re.fullmatch(r'[a-z][a-z0-9-]{0,45}', tag),
            'Unexpected Cloud Run URL/tag')
    return 'https://' + tag + '---' + parsed.hostname
