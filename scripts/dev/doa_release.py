"""DOA DEV release guards. Only allowlisted cloud metadata reads exist here.

API and web can have different serving source/builds. A tagged web preview may
remain the template while an older revision still serves traffic. Build overlays
use the proven serving image; current template configuration and tags are retained.
Configuration snapshots remain private; no secret payload is accessed or printed.
"""
import json
import re
import subprocess
from urllib.parse import urlsplit

import b2b_release as common

ROOT, PROJECT, REGION, BUILD_REGION = common.ROOT, common.PROJECT, common.REGION, common.BUILD_REGION
API, WEB, DEV, PROTECTED, REGISTRY = common.API, common.WEB, common.DEV, common.PROTECTED, common.REGISTRY
# Reuse only environment-independent helpers and the existing fixed read allowlist.
require, timestamp, digest_file, digest_json = common.require, common.timestamp, common.digest_file, common.digest_json
git, clean_source, ready, active = common.git, common.clean_source, common.ready, common.active
tags, portable, fingerprint, identity = common.tags, common.portable, common.fingerprint, common.identity
env_map, set_env, image_of = common.env_map, common.set_env, common.image_of
private_directory, private_json, private_read = common.private_directory, common.private_json, common.private_read
files_manifest, parse_time, tagged_url = common.files_manifest, common.parse_time, common.tagged_url

MIGRATIONS = {
    '20261001090000_mailroom_workbenches': '13dce515167e138f3f146acc47444abd6d0d4ccf1c2f2939ce04effae49b3906',
    '20261002090000_mailroom_intake_review': 'e51142a26a7413b9830ea29f740a498aa9a6869a0e9d370f0a128499ab3c1d11',
    '20261002100000_repair_technician_role': '5c526dfeb9abdbc29ce6122500f671291de22913e697f5e953ae35df6ca905bd',
    '20261002110000_repair_documents': 'eeefe57e81581ba27390e6c7d7636458087b11cedc36ae252db0acb77d35a96f',
}
# These source additions belong to an existing reviewed B2B line. They are not
# silently applied by this release; the separate DEV DB audit must reconcile them.
PREREQUISITE_MIGRATIONS = {
    '20260924000000_b2b_formal_quote_procurement': '9d3ea52a95d54a8e7d60e5d6659b3b74ceebed56b006ed058348256121cb4af3',
    '20260929000000_b2b_public_price_books': '4f6439ebce9656fe0e9bd2e80d319252b7866e8e3177a9be34c1363f39a387ba',
    '20260929010000_b2b_guest_inquiries': 'a4d21d3e32343e9721a6dbc2109ba02801411e53bc67406d2f2bab19aadf3067',
    '20260930000000_b2b_catalog_brand': '6a90a0e5e78ebba21082d42dd9a322e45b70d2e4071a9b0bb0f8155d201a1536',
    '20260930010000_b2b_guest_to_request': '84ac64f6952b11a9198d75f0a5b7a689556dd51069ef2fe3ee055b27437fe313',
    '20260930020000_b2b_private_quote_email': 'd92f159f39f75f20b162d31d938fb72ee10520d634acef4f5a4e0b1bb0f04267',
}
REVIEWED_RUNTIME_FILES = ('backend/scripts/dev-sandbox.cjs', 'frontend/server.mjs')
UNCHANGED_RUNTIME = tuple(p for p in common.UNCHANGED_RUNTIME if p not in REVIEWED_RUNTIME_FILES)
SOURCE_HOST = 'moztech-after-sales-dev-sp5g377smq-de.a.run.app'
CONNECTION_SECRET = 'corely-mailroom-dev-connections'
CONNECTION_VERSION = '1'
SERVING_BUILD_REGIONS = ('global', 'asia-east1')


def cloud(kind, target, *, build_region=BUILD_REGION):
    """Read fixed-project metadata; only historical builds may select a region."""
    require(build_region in SERVING_BUILD_REGIONS, 'Historical build region is outside read allowlist')
    if kind != 'build' or build_region == BUILD_REGION:
        require(kind == 'build' or build_region == BUILD_REGION, 'Build region applies only to build metadata reads')
        return common.cloud(kind, target)
    require(re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', target or ''),
            'Expected Cloud Build UUID')
    result = subprocess.run(['gcloud', 'builds', 'describe', target, '--region=' + build_region,
                             '--project=' + PROJECT, '--format=json'], text=True, capture_output=True)
    require(result.returncode == 0, 'Cloud metadata read failed; credential-bearing output suppressed')
    return json.loads(result.stdout)


def validate_serving_evidence(evidence):
    require(isinstance(evidence, dict) and set(evidence) == set(DEV),
            'Need independent API and web source/build evidence')
    for row in evidence.values():
        require(isinstance(row, dict) and set(row) == {'sourceSha', 'buildId', 'buildRegion'} and
                all(isinstance(value, str) for value in row.values()), 'Serving evidence must pin source, build ID and region')
        require(re.fullmatch(r'[0-9a-f]{40}', row['sourceSha']) and
                re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', row['buildId']),
                'Invalid serving source/build evidence')
        require(row['buildRegion'] in SERVING_BUILD_REGIONS, 'Historical build region is outside read allowlist')


def verify_source(source, live_sources):
    require(set(live_sources) == set(DEV), 'Need API and web serving sources independently')
    require(re.fullmatch(r'[0-9a-f]{40}', source or ''), 'Use full committed source SHA')
    for name, live_source in live_sources.items():
        require(re.fullmatch(r'[0-9a-f]{40}', live_source or '') and
                git('rev-parse', live_source + '^{commit}') == live_source, 'Serving source unavailable: ' + name)
        process = subprocess.run(['git', 'merge-base', '--is-ancestor', live_source, source], cwd=ROOT,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        require(process.returncode == 0, 'Source must include currently serving source: ' + name)
        paths = [p for p in UNCHANGED_RUNTIME if p.startswith('backend/' if name == API else 'frontend/')]
        require(not git('diff', '--name-only', live_source, source, '--', *paths),
                'Unreviewed dependency/startup/assets/server runtime change: ' + name)
    reviewed = {**PREREQUISITE_MIGRATIONS, **MIGRATIONS}
    changed = git('diff', '--name-status', live_sources[API], source, '--', 'backend/prisma/migrations')
    for line in changed.splitlines():
        pieces = line.split('\t')
        require(len(pieces) == 2 and pieces[0] == 'A', 'Existing migration changed; stop for review')
        require(any(pieces[1] == f'backend/prisma/migrations/{name}/migration.sql' for name in reviewed),
                'Unreviewed migration in overlay: ' + pieces[1])
    for name, expected in reviewed.items():
        require(digest_file(ROOT / 'backend/prisma/migrations' / name / 'migration.sql') == expected,
                'Reviewed migration checksum changed: ' + name)


def source_origin(value):
    parsed = urlsplit(value or '')
    require(parsed.scheme == 'https' and parsed.hostname and parsed.netloc == parsed.hostname and
            parsed.path in ('', '/') and not parsed.query and not parsed.fragment,
            'Mailroom source must be an exact DEV HTTPS origin')
    host = parsed.hostname
    require(host == SOURCE_HOST or re.fullmatch(r'[a-z][a-z0-9-]{0,45}---' + re.escape(SOURCE_HOST), host),
            'Mailroom source is outside the fixed after-sales DEV service')
    return 'https://' + host


def source_options(enabled=False, url=None, secret=None, version=None, events_enabled=False):
    require(isinstance(enabled, bool) and isinstance(events_enabled, bool), 'Source release switches must be booleans')
    require(not secret or secret == CONNECTION_SECRET, 'Only the fixed DEV connection secret is allowed')
    require(not version or version == CONNECTION_VERSION, 'Only reviewed fixed secret version 1 is allowed')
    require(bool(secret) == bool(version), 'Connection secret and pinned version must be supplied together')
    require(not enabled or (url and secret and version), 'Source enabling needs confirmed DEV origin and pinned DEV connection reference')
    require(enabled or not url, 'Source URL is only accepted with explicit source enabling')
    require(not events_enabled or enabled, 'DEV event delivery requires source enabling')
    origin = source_origin(url) if enabled else None
    require(not events_enabled or origin == 'https://' + SOURCE_HOST, 'DEV event delivery requires the canonical after-sales DEV origin')
    return {'enabled': bool(enabled), 'url': origin,
            'secret': secret, 'version': version, 'eventsEnabled': events_enabled}


def guards(value):
    name = value['metadata']['name']
    require(name in DEV, 'Refusing a non-DEV mutation plan')
    require(value['metadata'].get('namespace') == '249593319772' and
            value['metadata'].get('labels', {}).get('environment') == 'dev', 'Unexpected DEV namespace/label')
    env = env_map(value)
    required = ({'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921', 'DB_USER': 'erp_dev_runtime',
                 'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false'}
                if name == API else {'ERP_DEV_ENVIRONMENT': 'true', 'STAGED_OPERATIONS_ENABLED': 'false'})
    for key, expected in required.items():
        require(env.get(key, {}).get('value') == expected, 'DEV protection changed: ' + key)
    account = 'corely-erp-dev-rt' if name == API else 'corely-erp-dev-web'
    require(value['spec']['template']['spec'].get('serviceAccountName') ==
            account + '@' + PROJECT + '.iam.gserviceaccount.com', 'Unexpected DEV service account')
    if name == API:
        events = env.get('ERP_DEV_MAILROOM_EVENTS_ENABLED', {}).get('value', 'false')
        sync = env.get('MAILROOM_SYNC_ENABLED', {}).get('value', 'false')
        require(events in ('true', 'false') and sync in ('true', 'false'), 'Mailroom delivery switches must be explicit booleans')
        if events == 'true':
            require(sync == 'true' and env.get('ERP_DEV_MAILROOM_SOURCE_ENABLED', {}).get('value') == 'true',
                    'DEV event delivery requires the paired DEV source and sync switches')
            require(env.get('ERP_DEV_MAILROOM_SOURCE_URL', {}).get('value') == 'https://' + SOURCE_HOST,
                    'DEV event delivery requires the canonical after-sales DEV origin')
            require(value['spec']['template'].get('metadata', {}).get('annotations', {}).get('run.googleapis.com/cpu-throttling') == 'false',
                    'DEV event delivery requires CPU allocation between requests')
        else:
            require(sync == 'false', 'External mailroom event delivery must remain disabled')
        for key in ('MAILROOM_CONNECTIONS', 'MAILROOM_READERS'):
            if key in env:
                require(env[key].get('valueFrom', {}).get('secretKeyRef') ==
                        {'name': CONNECTION_SECRET, 'key': CONNECTION_VERSION}, 'Only fixed pinned DEV mailroom secret references are allowed: ' + key)
        if env.get('ERP_DEV_MAILROOM_SOURCE_ENABLED', {}).get('value') == 'true':
            require(env.get('MAILROOM_ENABLED', {}).get('value') == 'true', 'Mailroom source requires workbench enablement')
            source_origin(env.get('ERP_DEV_MAILROOM_SOURCE_URL', {}).get('value'))
            require(env.get('MAILROOM_CONNECTIONS', {}).get('valueFrom', {}).get('secretKeyRef') ==
                    {'name': CONNECTION_SECRET, 'key': CONNECTION_VERSION}, 'Mailroom source needs the fixed pinned DEV secret reference')
            require(env.get('MAILROOM_READERS', {}).get('valueFrom', {}).get('secretKeyRef') ==
                    {'name': CONNECTION_SECRET, 'key': CONNECTION_VERSION}, 'Progress readback needs the same fixed pinned DEV secret reference')


def snapshot_all():
    return {name: cloud('service', name) for name in DEV + PROTECTED}


def assert_snapshot(expected, live):
    for name in DEV + PROTECTED:
        require(identity(live[name]) == identity(expected[name]), name + ': cloud state changed; coordinate again')
    for name in DEV:
        guards(live[name])
        require(ready(live[name]), name + ': service is not Ready')


def build_image(build, name, source, historical=False):
    require(name in DEV and build.get('status') == 'SUCCESS', 'Expected successful DEV build')
    outputs = build.get('results', {}).get('images', [])
    declared = build.get('images', [])
    require(outputs and len(outputs) == len(declared) and
            sorted(row.get('name') for row in outputs) == sorted(declared) and
            all(any(row.get('name', '').startswith(REGISTRY + s + ':') for s in DEV) for row in outputs),
            'Build has unexpected image outputs')
    found = [row for row in outputs if row['name'].startswith(REGISTRY + name + ':')]
    require(len(found) == 1 and re.fullmatch(r'sha256:[0-9a-f]{64}', found[0].get('digest', '')), 'Build must identify one immutable image: ' + name)
    tag = found[0]['name'].split(':')[-1]
    if historical:
        match = re.search(r'(?:^|-)([0-9a-f]{8,40})$', tag)
        require(match and source.startswith(match[1]) and git('rev-parse', match[1] + '^{commit}') == source,
                'Serving build tag does not uniquely identify source: ' + name)
    else:
        require(tag == 'doa-' + source, 'Candidate image is for another source')
    return REGISTRY + name + '@' + found[0]['digest']


def build_images(build, source):
    require(len(build.get('results', {}).get('images', [])) == 2, 'Candidate build needs exactly both DEV images')
    return {name: build_image(build, name, source) for name in DEV}


def capture_baseline(evidence):
    validate_serving_evidence(evidence)
    live = snapshot_all()
    serving_images, images, template_images, revisions, templates = {}, {}, {}, {}, {}
    for name in DEV:
        value = live[name]
        guards(value)
        require(ready(value), name + ': service is not Ready')
        current = active(value)
        require(len(current) == 1 and current[0][1] == 100 and
                all(not row.get('latestRevision') for row in value['spec'].get('traffic', [])), 'Expected explicit single 100% serving revision: ' + name)
        latest = value['status'].get('latestReadyRevisionName')
        require(latest and latest == value['status'].get('latestCreatedRevisionName'), 'Unready concurrent candidate: ' + name)
        tags(value)
        serving = cloud('revision', current[0][0])
        require(ready(serving), 'Serving revision is not Ready: ' + name)
        proven = build_image(cloud('build', evidence[name]['buildId'], build_region=evidence[name]['buildRegion']),
                             name, evidence[name]['sourceSha'], historical=True)
        require(serving['status'].get('imageDigest') == proven, 'Serving build digest does not match active revision: ' + name)
        template = cloud('revision', latest)
        base_image = template.get('status', {}).get('imageDigest', '')
        require(ready(template) and re.fullmatch(re.escape(REGISTRY + name) + r'@sha256:[0-9a-f]{64}', base_image) and
                image_of(value) == base_image, 'Template image must match its Ready immutable revision: ' + name)
        if latest != current[0][0]:
            require(any(row.get('tag') and row.get('revisionName') == latest and not row.get('percent', 0)
                        for row in value['spec'].get('traffic', [])), 'Existing template candidate must have an explicit preserved zero-traffic tag')
        serving_images[name], images[name] = proven, proven
        template_images[name], revisions[name], templates[name] = base_image, serving, template
    return {'capturedAt': timestamp(), 'servingEvidence': evidence,
            'sourceEvidence': 'per-service-successful-build-source-tags-and-serving-digests',
            'services': live, 'activeRevisions': revisions, 'templateRevisions': templates,
            'servingImages': serving_images, 'images': images, 'templateImages': template_images}


def verify_context(context):
    context = private_directory(context)
    manifest = private_read(context / 'manifest.json')
    require(manifest.get('version') == 1 and manifest.get('project') == PROJECT and
            manifest.get('region') == REGION and manifest.get('devOnly') is True, 'Wrong DOA build manifest environment')
    require(files_manifest(context) == manifest.get('filesSha256'), 'Prepared build context changed')
    source = manifest.get('sourceSha', '')
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'Invalid manifest source SHA')
    validate_serving_evidence(manifest.get('baseline', {}).get('servingEvidence'))
    require(manifest.get('migrationChecksums') == MIGRATIONS and
            manifest.get('prerequisiteMigrationChecksums') == PREREQUISITE_MIGRATIONS, 'Manifest migration checksums changed')
    require(manifest.get('images') == [REGISTRY + s + ':doa-' + source for s in DEV], 'Unexpected build image destinations')
    runtime = manifest.get('reviewedRuntimeFiles', {})
    require(set(runtime) == set(REVIEWED_RUNTIME_FILES), 'Both reviewed runtime overlays are required')
    for original, expected in runtime.items():
        destination = context / ('backend/dev-sandbox.cjs' if original.startswith('backend/') else 'frontend/server.mjs')
        require(re.fullmatch(r'[0-9a-f]{64}', expected) and digest_file(destination) == expected,
                'Reviewed runtime overlay hash changed: ' + original)
    return manifest


def migration_receipt(path, source):
    value = private_read(path)
    expected = {'version': 1, 'project': PROJECT, 'database': 'erp_dev_20260921', 'dbUser': 'erp_dev_runtime',
                'schema': 'public', 'sourceSha': source, 'allApplied': True}
    require(all(value.get(key) == expected_value for key, expected_value in expected.items()), 'Migration receipt environment/source mismatch')
    validated = parse_time(value.get('validatedAt'))
    rows = value.get('migrations', [])
    require(isinstance(rows, list) and len(rows) == 4 and {row.get('name') for row in rows} == set(MIGRATIONS), 'Receipt must cover exactly four reviewed DOA migrations')
    for row in rows:
        require(row.get('sha256') == MIGRATIONS[row['name']] and row.get('status') == 'applied' and
                row.get('ledgerVerified') is True and row.get('objectsVerified') is True,
                'Migration ledger/objects/checksum not verified: ' + row['name'])
        require(parse_time(row.get('finishedAt')) <= validated, 'Migration finished after receipt validation')
    require(value.get('unrelatedPendingMigrations') == [], 'DB audit must confirm no unrelated pending migrations')
    return {'path': str(path.absolute()), 'sha256': digest_file(path), 'validatedAt': value['validatedAt']}
