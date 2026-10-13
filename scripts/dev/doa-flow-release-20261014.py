#!/usr/bin/env python3
"""Prepare five DEV services, offline. No cloud writes, secret access or DB calls.

`prepare-build` exports clean, exact Git sources and the reviewed WMS manifest,
then writes Docker/Cloud Build recipes. It DOES NOT execute those recipes.
`candidate` consumes SUCCESS build receipts and writes Knative Service JSON
(JSON is a YAML subset). Existing traffic percentages, foreign tags, container
names/order, IAM annotations, secret references and runtime settings survive.
`verify-fresh` compares all nine expected/current service descriptions, including
resourceVersion, immediately before the release owner performs a CAS replace.
`verify-context` checks the pinned manifest/context before external submission.
`verify-builds` converts explicit regional SUCCESS descriptions into the six
immutable digests; build steps must match the prepared recipes.

Keep the output private. The release owner separately executes builds, reviewed
migrations, candidate replacements, authenticated acceptance and promotion.
There is intentionally no submit, deploy, migrate, promote or execute command.
"""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
from datetime import datetime, timezone

PROJECT, REGION, NAMESPACE = 'moztech-main-db', 'asia-east1', '249593319772'
REGISTRY = f'{REGION}-docker.pkg.dev/{PROJECT}/cloud-run/'
API, WEB = 'corely-erp-api-dev', 'corely-erp-dev'
SOURCE, MODULE, WMS = 'moztech-after-sales-dev', 'corely-aftersales-module-dev', 'corely-wms-dev'
DEV = (API, WEB, SOURCE, MODULE, WMS)
PROTECTED = ('ecom-accounting-backend', 'ecom-accounting-frontend', 'corely-wms', 'moztech-after-sales-system')
ALL = DEV + PROTECTED
IMAGE_KEYS = {API: API, WEB: WEB, SOURCE: SOURCE, MODULE: MODULE,
              'wms-web': 'corely-wms-frontend', 'wms-api': 'corely-wms-backend'}
SERVICE_IMAGES = {API: (API,), WEB: (WEB,), SOURCE: (SOURCE,), MODULE: (MODULE,), WMS: ('wms-web', 'wms-api')}
ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r'^[a-f0-9]{40}$')
DIGEST = re.compile(r'^sha256:[a-f0-9]{64}$')
WMS_SOURCE = '5c056d40404cf39dfdb2c8eaf2b2d46768995cfd'
WMS_MANIFEST_HASH = '0b53e545c98bf6978f29f72ad754a3b760d31de1e6db2bab6b626e72d7d71e46'
# Supplier's digest uses its own recipe. Independently pin the canonical rows
# and verify each byte rather than assuming that recipe's serialization.
WMS_ROWS_HASH = '24e1370034c65e42b31c6bbe30b2b1df9302ad31051d43946e30c07e636f18ad'
STORAGE_VERSION = '7.19.0'
ORIGINS = {s: f'https://{s}-sp5g377smq-de.a.run.app' for s in DEV}
EXISTING_EXTERNAL_REFS = {
    (API, 'corely-erp-api-dev-1', 'GEMINI_API_KEY'): ('ecom-accounting-gemini-api-key', '1'),
    (WMS, 'api', 'WMS_SHOPIFY_ACCESS_TOKEN'): ('ecom-accounting-shopify-admin-token', '1'),
    (WMS, 'api', 'WMS_SHOPLINE_ACCESS_TOKEN'): ('ecom-accounting-shopline-access-token', '2'),
    (WMS, 'api', 'WMS_1SHOP_STORES_JSON'): ('ecom-accounting-oneshop-stores-json', '1'),
}
REPAIR_VALUES = {
    'REPAIR_MEDIA_ENABLED': 'true', 'REPAIR_MEDIA_BUCKET': 'corely-repair-dev-249593319772',
    'REPAIR_MEDIA_UPLOAD_ORIGIN': ORIGINS[WEB], 'REPAIR_PUBLIC_REPORT_ENABLED': 'true',
    'REPAIR_REPORT_PUBLIC_ORIGIN': ORIGINS[WEB], 'ERP_DEV_AFTER_SALES_WORKFLOW_ENABLED': 'true',
    'WMS_NATIVE_ENABLED': 'true',
}
NEW_SECRET = {'REPAIR_REPORT_LINK_SECRET': {'secretKeyRef': {'name': 'corely-repair-report-dev-link-secret', 'key': '1'}}}
VOLATILE_ANNOTATIONS = {'run.googleapis.com/operation-id', 'serving.knative.dev/creator',
                        'serving.knative.dev/lastModifier', 'run.googleapis.com/urls',
                        'run.googleapis.com/client-name', 'run.googleapis.com/client-version'}
EXCLUDED_PARTS = {'.git', 'node_modules', '.next', '.next-dev', 'dist', 'coverage', 'artifacts',
                  'outputs', 'handoff', 'screenshots', '.codex', 'tmp'}


def require(value, message):
    if not value:
        raise RuntimeError(message)


def full_sha(value):
    require(isinstance(value, str) and SHA.fullmatch(value), 'A full lowercase 40-character source SHA is required')
    return value


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def read_json(path):
    path = Path(path)
    require(not path.is_symlink() and path.is_file(), 'Input must be an ordinary file')
    return json.loads(path.read_text())


def private_dir(path):
    path = Path(path).absolute()
    require(not path.exists() and not path.is_symlink(), 'Output must be a new directory')
    require(not any(p.is_symlink() for p in (path.parent, *path.parent.parents)), 'Symlinked output parents are forbidden')
    path.mkdir(parents=True, mode=0o700)
    path.chmod(0o700)
    return path


def private_write(path, contents):
    path = Path(path)
    require(not any(p.is_symlink() for p in (path.parent, *path.parent.parents)), 'Symlinked output parents are forbidden')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not path.exists() and not path.is_symlink(), 'Output file must be new')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'wb') as file:
        file.write(contents if isinstance(contents, bytes) else contents.encode())


def private_json(path, value):
    private_write(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def containers(service):
    return service['spec']['template']['spec']['containers']


def env_map(container):
    values = container.get('env', [])
    require(isinstance(values, list) and all(isinstance(e, dict) and isinstance(e.get('name'), str) for e in values),
            'Invalid container environment rows')
    require(len({e['name'] for e in values}) == len(values), 'Duplicate environment names are forbidden')
    require(all(set(e) in ({'name', 'value'}, {'name', 'valueFrom'}) for e in values), 'Ambiguous environment entry')
    require(all(isinstance(e.get('value'), str) if 'value' in e else
                isinstance(e['valueFrom'], dict) and set(e['valueFrom']) == {'secretKeyRef'} and
                set(e['valueFrom']['secretKeyRef']) == {'name', 'key'} and
                all(isinstance(v, str) and v for v in e['valueFrom']['secretKeyRef'].values()) for e in values),
            'Invalid environment value or secret reference')
    return {e['name']: e for e in values}


def value(container, name):
    return env_map(container).get(name, {}).get('value')


def need_values(container, expected):
    require(all(value(container, k) == v for k, v in expected.items()), 'DEV runtime/database identity or disabled-effect flags differ')


def need_secret(container, name, ref, key=None):
    secret = env_map(container).get(name, {}).get('valueFrom', {}).get('secretKeyRef', {})
    require(secret.get('name') == ref and (key is None or secret.get('key') == key), 'DEV secret reference identity differs')


def secret_reference_manifest(snapshot):
    result = []
    for name in DEV:
        for c in containers(snapshot[name]):
            for e in c.get('env', []):
                if 'valueFrom' not in e:
                    continue
                ref = e['valueFrom']['secretKeyRef']
                identity = (name, c.get('name'), e['name'])
                external = identity in EXISTING_EXTERNAL_REFS
                if external:
                    require((ref['name'], ref['key']) == EXISTING_EXTERNAL_REFS[identity], 'Approved existing external reference changed')
                else:
                    require('dev' in ref['name'] and '/' not in ref['name'], 'Non-DEV secret reference is not explicitly allowlisted')
                result.append({'service': name, 'container': c.get('name'), 'environmentKey': e['name'],
                               'name': ref['name'], 'version': ref['key'], 'preservedExistingExternalReference': external})
    require(sum(r['preservedExistingExternalReference'] for r in result) == len(EXISTING_EXTERNAL_REFS),
            'The four approved existing external references must be preserved')
    return result


def snapshot_guard(snapshot):
    require(isinstance(snapshot, dict) and set(snapshot) == set(ALL), 'Exactly five DEV and four protected services are required')
    for name in ALL:
        s = snapshot[name]
        m = s['metadata']
        require(m['name'] == name and m['namespace'] == NAMESPACE and m.get('resourceVersion') and m.get('uid'),
                'Service identity/resourceVersion/uid is missing or wrong')
        require(s.get('kind') == 'Service' and s.get('apiVersion') == 'serving.knative.dev/v1', 'Unexpected service API')
        ready = s['status']
        require(any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in ready['conditions']) and
                ready.get('latestCreatedRevisionName') == ready.get('latestReadyRevisionName'), 'Unready concurrent revision exists')
        traffic = s['spec']['traffic']
        require(isinstance(traffic, list) and sum(t.get('percent', 0) for t in traffic) == 100 and
                all(isinstance(t.get('revisionName'), str) and not t.get('latestRevision') and
                    isinstance(t.get('percent', 0), int) and 0 <= t.get('percent', 0) <= 100 for t in traffic),
                'Explicit revision traffic totaling 100 is required')
        require(len({t['tag'] for t in traffic if t.get('tag')}) == sum(bool(t.get('tag')) for t in traffic), 'Duplicate service traffic tags')
        if name not in DEV:
            continue
        require(ready.get('url') == ORIGINS[name], 'Canonical DEV service origin differs')
        expected_names = {API: ['corely-erp-api-dev-1'], WEB: ['corely-erp-dev-1'],
                          SOURCE: [None], MODULE: [None], WMS: ['web', 'api']}[name]
        require([c.get('name') for c in containers(s)] == expected_names, 'Named container topology changed')
        for c, key in zip(containers(s), SERVICE_IMAGES[name]):
            require(c['image'].startswith(REGISTRY + IMAGE_KEYS[key] + '@') and DIGEST.fullmatch(c['image'].split('@')[-1]),
                    'DEV template must pin the expected image repository/digest')
            env_map(c)
        # WMS has no environment label. Its named containers, database, user and
        # secret references establish the actual isolated identity instead.
    api, web = containers(snapshot[API])[0], containers(snapshot[WEB])[0]
    need_values(api, {'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921', 'DB_USER': 'erp_dev_runtime',
                      'SEED_ON_STARTUP': 'false', 'RUNTIME_SCHEDULES_ENABLED': 'false'})
    need_secret(api, 'DB_PASSWORD', 'corely-erp-dev-db-password', '1')
    need_secret(api, 'JWT_SECRET', 'corely-erp-dev-jwt', '1')
    need_values(web, {'ERP_DEV_ENVIRONMENT': 'true'})
    for name in (SOURCE, MODULE):
        c = containers(snapshot[name])[0]
        module = 'true' if name == MODULE else 'false'
        need_values(c, {'AS_MAILROOM_DEV': 'true', 'APP_ENV': 'development', 'RUNTIME_ENV': 'dev',
                        'ERP_MODULE_BUILD': module, 'NEXT_PUBLIC_ERP_MODULE': module, 'ERP_MODULE_ENABLED': module})
        need_secret(c, 'DATABASE_URL', 'moztech-aftersales-dev-database-url', '2')
        # New receiver/selector remains disabled. Source invoice/LINE stubs and
        # DB-held brand profiles require separate acceptance; never add tokens.
        require(not any(e['name'] in {'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'ECPAY_HASH_KEY',
                                      'ECPAY_HASH_IV', 'ATTACHMENT_GCS_BUCKET', 'AFTER_SALES_AI_CONNECTORS_JSON'}
                        for e in c.get('env', [])), 'Real Source provider configuration is forbidden in this release')
    wms = containers(snapshot[WMS])[1]
    need_values(wms, {'PGDATABASE': 'corely_wms_dev_20260915', 'PGUSER': 'corely_wms_dev_20260915',
                      'WMS_ECPAY_CALLBACKS_ENABLED': 'false', 'ERP_PORTAL_ONLY': 'true'})
    need_secret(wms, 'PGPASSWORD', 'corely-wms-dev-db-password', '1')
    need_secret(wms, 'JWT_SECRET', 'corely-wms-dev-jwt', '1')
    return secret_reference_manifest(snapshot)


def portable(service):
    result = copy.deepcopy(service)
    result.pop('status', None)
    m = result['metadata']
    result['metadata'] = {k: v for k, v in m.items() if k in {'name', 'namespace', 'resourceVersion', 'labels', 'annotations'}}
    for target in (result['metadata'], result['spec']['template']['metadata']):
        if 'annotations' in target:
            target['annotations'] = {k: v for k, v in target['annotations'].items() if k not in VOLATILE_ANNOTATIONS}
    return result


def assert_fresh(expected, observed):
    snapshot_guard(expected)
    snapshot_guard(observed)
    for name in ALL:
        old, new = expected[name], observed[name]
        require(old['metadata']['resourceVersion'] == new['metadata']['resourceVersion'] and
                old['metadata']['uid'] == new['metadata']['uid'] and portable(old) == portable(new) and
                old['status']['latestReadyRevisionName'] == new['status']['latestReadyRevisionName'],
                'Fresh CAS snapshot differs for ' + name)
    return {name: observed[name]['metadata']['resourceVersion'] for name in ALL}


def source_pins(erp, source, wms):
    return {'erp': full_sha(erp), 'source': full_sha(source), 'wms': full_sha(wms)}


def git(root, *args, binary=False):
    result = subprocess.run(['git', '-C', str(root), *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    require(result.returncode == 0, 'Local Git read failed; command output suppressed')
    return result.stdout if binary else result.stdout.decode().strip()


def clean_checkout(root, sha):
    require(Path(root).is_dir() and not Path(root).is_symlink(), 'Source root must be a real directory')
    require(git(root, 'rev-parse', 'HEAD') == full_sha(sha), 'Checkout is not the exact frozen source SHA')
    require(not git(root, 'status', '--porcelain', '--untracked-files=all'), 'Checkout must be completely clean before preparation')


def allowed_file(path):
    p = PurePosixPath(path)
    return not (p.is_absolute() or '..' in p.parts or not p.parts or any(x in EXCLUDED_PARTS for x in p.parts) or
                any(x == '.env' or x.startswith('.env.') for x in p.parts) or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx', '.sqlite', '.db'} or
                any(x.lower() in {'credentials.json', 'service-account.json', 'secrets.json'} for x in p.parts))


def export_git(root, sha, target, prefix=''):
    rows = git(root, 'ls-tree', '-r', '-z', sha, '--', prefix, binary=True).split(b'\0')
    manifest = []
    for row in rows:
        if not row:
            continue
        meta, raw_path = row.split(b'\t', 1)
        mode, kind, object_id = meta.decode().split()
        path = raw_path.decode()
        relative = path[len(prefix):].lstrip('/') if prefix else path
        if not allowed_file(relative):
            continue  # Do not read a filtered credential/data blob.
        require(kind == 'blob' and mode in {'100644', '100755'}, 'Symlinks/submodules cannot enter a build context')
        content = git(root, 'cat-file', 'blob', object_id, binary=True)
        destination = target / relative
        private_write(destination, content)
        if mode == '100755':
            destination.chmod(0o700)
        manifest.append({'path': relative, 'sha256': sha256(content)})
    require(manifest, 'Empty source export')
    return manifest


def wms_context(root, sha, target=None):
    full_sha(sha)
    manifest = read_json(Path(root) / 'source-manifest.json')
    require(manifest.get('commit') == sha == WMS_SOURCE and manifest.get('environment') == 'dev' and
            manifest.get('digest') == WMS_MANIFEST_HASH, 'WMS supplier freeze differs')
    rows = manifest['files']
    require(isinstance(rows, list) and len(rows) == 273 and len({r['path'] for r in rows}) == len(rows), 'WMS exact 273-file manifest required')
    require(sha256(canonical(rows)) == WMS_ROWS_HASH, 'WMS manifest row digest differs')
    source = Path(root) / 'build-source'
    actual = {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file() or p.is_symlink()}
    require(actual == {r['path'] for r in rows}, 'WMS context contains missing/extra files')
    for row in rows:
        path = source / row['path']
        require(allowed_file(row['path']) and not path.is_symlink() and path.is_file() and
                not any(p.is_symlink() for p in path.parents), 'Unsafe WMS context path')
        content = path.read_bytes()
        require(sha256(content) == row['sha256'], 'WMS supplier file hash differs')
        if target:
            private_write(target / row['path'], content)
    return copy.deepcopy(manifest)


def migration_hashes(root, prefix):
    base = Path(root) / prefix
    return {p.parent.name: sha256(p.read_bytes()) for p in sorted(base.glob('*/migration.sql'))}


def package_fingerprints(root, prefixes):
    result = {}
    for label, prefix in prefixes.items():
        directory = Path(root) / prefix
        package = read_json(directory / 'package.json')
        lock = read_json(directory / 'package-lock.json')
        result[label] = {'packageSha256': sha256((directory / 'package.json').read_bytes()),
                         'lockSha256': sha256((directory / 'package-lock.json').read_bytes()),
                         'storageDeclared': package.get('dependencies', {}).get('@google-cloud/storage'),
                         'storageResolved': lock.get('packages', {}).get('node_modules/@google-cloud/storage', {}).get('version'),
                         'prismaResolved': lock.get('packages', {}).get('node_modules/prisma', {}).get('version')}
    return result


def erp_api_docker(base, sha):
    require(base.startswith(REGISTRY + API + '@sha256:'), 'ERP API immutable DEV base required')
    dummy = 'postgresql://unconnected:unconnected@127.0.0.1:1/unconnected?schema=public'
    return f'''FROM {base} AS builder
USER root
WORKDIR /app
RUN rm -rf node_modules dist prisma
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN DATABASE_URL="{dummy}" npm ci --include=dev --no-audit --no-fund
COPY src ./src
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY assets ./assets
RUN DATABASE_URL="{dummy}" ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma && npm run build
FROM {base}
USER root
WORKDIR /app
RUN rm -rf node_modules dist prisma
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN DATABASE_URL="{dummy}" npm ci --omit=dev --no-audit --no-fund && DATABASE_URL="{dummy}" ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
ENV SOURCE_VERSION={sha}
LABEL org.opencontainers.image.revision="{sha}"
'''


def erp_web_docker(base, sha):
    return f'''FROM {base} AS builder
USER root
WORKDIR /app
RUN rm -rf node_modules dist
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run build
FROM {base}
WORKDIR /app
RUN rm -rf dist
COPY --from=builder /app/dist ./dist
COPY server.mjs ./server.mjs
ENV SOURCE_VERSION={sha}
LABEL org.opencontainers.image.revision="{sha}"
'''


def build_prepare(baseline, pins, erp_root, source_root, wms_root, output):
    refs = snapshot_guard(baseline)
    clean_checkout(erp_root, pins['erp'])
    clean_checkout(source_root, pins['source'])
    wms = wms_context(wms_root, pins['wms'])
    dependencies = package_fingerprints(erp_root, {'api': 'backend', 'web': 'frontend'})
    dependencies.update(package_fingerprints(source_root, {'source': ''}))
    dependencies.update(package_fingerprints(Path(wms_root) / 'build-source', {'wms-api': 'backend', 'wms-web': 'frontend'}))
    require(dependencies['api']['storageDeclared'] == STORAGE_VERSION and dependencies['api']['storageResolved'] == STORAGE_VERSION,
            'ERP API @google-cloud/storage must be exactly 7.19.0 in package and lock')
    folder = private_dir(output)
    context = folder / 'build-context'
    context.mkdir(mode=0o700)
    exported = {'api': export_git(erp_root, pins['erp'], context / 'api', 'backend'),
                'web': export_git(erp_root, pins['erp'], context / 'web', 'frontend'),
                'source': export_git(source_root, pins['source'], context / 'source')}
    wms_context(wms_root, pins['wms'], context / 'wms')
    for name, docker in [('api', erp_api_docker(containers(baseline[API])[0]['image'], pins['erp'])),
                         ('web', erp_web_docker(containers(baseline[WEB])[0]['image'], pins['erp']))]:
        # Dockerfile source was exported for evidence; replace it only in this
        # new isolated build context. The original checkout is untouched.
        docker_path = context / name / 'Dockerfile'
        if docker_path.exists():
            docker_path.unlink()
        private_write(docker_path, docker)
    steps, images = [], {}
    for key, repository in IMAGE_KEYS.items():
        owner = 'wms' if key.startswith('wms-') else 'source' if key in (SOURCE, MODULE) else 'erp'
        image = REGISTRY + repository + ':doaf-' + pins[owner]
        images[key] = image
        directory = {API: 'api', WEB: 'web', SOURCE: 'source', MODULE: 'source', 'wms-web': 'wms/frontend', 'wms-api': 'wms/backend'}[key]
        args = ['build', '-t', image]
        if key in (SOURCE, MODULE):
            args += ['--build-arg', 'SOURCE_VERSION=' + pins['source'], '--build-arg', 'ERP_MODULE_BUILD=' + ('true' if key == MODULE else 'false')]
        if key == 'wms-web':
            args += ['-f', 'Dockerfile.cloudrun', '--build-arg', 'VITE_DEPLOY_ENV=dev', '--build-arg', 'VITE_SOURCE_COMMIT=' + pins['wms']]
        if key == 'wms-api':
            args += ['--label', 'org.opencontainers.image.revision=' + pins['wms']]
        args += ['.']
        # The two full Next builds must not compete for memory with each other.
        # This preparation favors a deterministic sequential build, not fanout.
        steps.append({'id': key, 'name': 'gcr.io/cloud-builders/docker', 'dir': directory, 'args': args,
                      'waitFor': [steps[-1]['id']] if steps else ['-']})
    private_json(context / 'cloudbuild.json', {'steps': steps, 'images': list(images.values()), 'timeout': '3600s',
                                              'options': {'logging': 'CLOUD_LOGGING_ONLY', 'machineType': 'E2_HIGHCPU_8'},
                                              'tags': ['doaf-' + pins['erp'][:12]]})
    # Cloud Build cannot upload the private baseline/receipts stored OUTSIDE
    # this directory. Files filtered before Git blob reads remain excluded.
    private_write(context / '.gcloudignore', '.git\n**/.env\n**/.env.*\n**/*.pem\n**/*.key\n')
    files = file_manifest(context)
    record = {'version': 1, 'mode': 'prepare-only', 'project': PROJECT, 'region': REGION, 'sourcePins': pins,
              'buildContext': str(context), 'images': images, 'files': files, 'contextSha256': sha256(canonical(files)),
              'exportedSourceFiles': exported,
              'dependencies': dependencies, 'wmsManifest': wms, 'existingReferenceAllowlist': refs,
              'migrationChecksums': {'erp': migration_hashes(erp_root, 'backend/prisma/migrations'),
                                     'source': migration_hashes(source_root, 'prisma/migrations')},
              'baselineFingerprint': sha256(canonical(baseline)), 'createdAt': datetime.now(timezone.utc).isoformat(),
              'executedBuild': False, 'appliedMigrations': False, 'deployed': False,
              'requires': ['Root submits exact context; SUCCESS immutable digests', 'separate reviewed DEV migration receipts',
                           'fresh nine-service resourceVersion check before each replacement', 'promote normal Source canonical before ERP candidate flow testing',
                           'authenticated six-case acceptance; stubs are not invoice/LINE delivery']}
    private_json(folder / 'build-manifest.private.json', record)
    clean_checkout(erp_root, pins['erp'])
    clean_checkout(source_root, pins['source'])
    return record


def file_manifest(directory):
    result = []
    for path in sorted(Path(directory).rglob('*')):
        require(not path.is_symlink(), 'Output context symlink forbidden')
        if path.is_file():
            result.append({'path': path.relative_to(directory).as_posix(), 'sha256': sha256(path.read_bytes())})
    return result


def verify_build_context(manifest_path, expected_sha256):
    require(isinstance(expected_sha256, str) and re.fullmatch(r'[a-f0-9]{64}', expected_sha256), 'Prepared manifest checksum is required')
    require(sha256(Path(manifest_path).read_bytes()) == expected_sha256, 'Prepared manifest checksum changed')
    manifest = read_json(manifest_path)
    require(manifest.get('version') == 1 and manifest.get('project') == PROJECT and manifest.get('region') == REGION and
            manifest.get('mode') == 'prepare-only', 'Unexpected prepared build manifest')
    pins = manifest['sourcePins']
    source_pins(pins['erp'], pins['source'], pins['wms'])
    require(pins['wms'] == WMS_SOURCE, 'WMS source pin changed')
    context = Path(manifest['buildContext'])
    require(context.is_absolute() and context.is_dir() and not any(p.is_symlink() for p in (context, *context.parents)), 'Unsafe prepared context')
    files = file_manifest(context)
    require(files == manifest['files'] and sha256(canonical(files)) == manifest['contextSha256'], 'Prepared context changed')
    require(set(manifest['images']) == set(IMAGE_KEYS), 'Prepared image matrix changed')
    for key, repository in IMAGE_KEYS.items():
        owner = 'wms' if key.startswith('wms-') else 'source' if key in (SOURCE, MODULE) else 'erp'
        require(manifest['images'][key] == REGISTRY + repository + ':doaf-' + pins[owner], 'Prepared source tag changed')
    config = read_json(context / 'cloudbuild.json')
    require(config.get('images') == list(manifest['images'].values()) and not config.get('secrets') and not config.get('availableSecrets'),
            'Unexpected build image list or secret injection')
    return manifest, config


def success_build_receipt(manifest_path, expected_sha256, build_paths, output):
    manifest, config = verify_build_context(manifest_path, expected_sha256)
    expected_steps = {s['id']: s for s in config['steps']}
    images, builds = {}, {}
    for path in build_paths:
        # Read-only GCloud captures must carry their explicitly selected region.
        # No mutable image, missing regional provenance or secret-bearing build
        # config can become an acceptable receipt.
        wrapper = read_json(path)
        require(set(wrapper) == {'region', 'description'} and wrapper['region'] == REGION, 'Explicit regional build capture required')
        raw = wrapper['description']
        require(raw.get('status') == 'SUCCESS' and raw.get('projectId') == PROJECT and raw.get('id') and
                not raw.get('secrets') and not raw.get('availableSecrets'), 'Successful isolated build description required')
        require(raw['id'] not in builds, 'Duplicate build ID')
        actual_steps = raw.get('steps', [])
        require(actual_steps and len({s.get('id') for s in actual_steps}) == len(actual_steps), 'Unique completed build steps required')
        for step in actual_steps:
            target = expected_steps.get(step.get('id'))
            require(target is not None and all(step.get(k) == v for k, v in target.items()) and
                    not any(k in step for k in ('env', 'secretEnv', 'script', 'entrypoint')), 'Build recipe does not match prepared source')
        require(set(raw.get('images', [])) <= set(manifest['images'].values()), 'Unprepared build image')
        builds[raw['id']] = {**raw, 'region': wrapper['region']}
        for key, tag in manifest['images'].items():
            if tag not in raw.get('images', []):
                continue
            require(key in {s['id'] for s in actual_steps}, 'Result has no exact prepared build step')
            rows = [v for v in raw.get('results', {}).get('images', []) if v.get('name') == tag]
            require(len(rows) == 1 and DIGEST.fullmatch(rows[0].get('digest', '')) and key not in images, 'Ambiguous/missing built digest')
            images[key] = {'image': REGISTRY + IMAGE_KEYS[key] + '@' + rows[0]['digest'], 'buildId': raw['id']}
    receipt = {'version': 1, 'project': PROJECT, 'sourcePins': manifest['sourcePins'], 'images': images, 'builds': builds,
               'preparedManifestSha256': expected_sha256, 'preparedContextSha256': manifest['contextSha256']}
    build_images(receipt, manifest['sourcePins'])
    private_json(output, receipt)
    return receipt


def build_images(receipt, pins):
    require(receipt.get('version') == 1 and receipt.get('project') == PROJECT and receipt.get('sourcePins') == pins,
            'Build receipt project/source pins differ')
    require(all(isinstance(receipt.get(k), str) and re.fullmatch(r'[a-f0-9]{64}', receipt[k]) for k in
                ('preparedManifestSha256', 'preparedContextSha256')), 'Prepared source/context proof is required')
    images, builds = receipt.get('images', {}), receipt.get('builds', {})
    require(set(images) == set(IMAGE_KEYS), 'Exactly six built images are required')
    for key, row in images.items():
        require(set(row) == {'image', 'buildId'} and row['image'].startswith(REGISTRY + IMAGE_KEYS[key] + '@') and
                DIGEST.fullmatch(row['image'].split('@')[-1]), 'Candidate image repository/digest differs')
        require(isinstance(row['buildId'], str) and re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', row['buildId']), 'Build ID must be a UUID')
        build = builds.get(row['buildId'], {})
        require(build.get('status') == 'SUCCESS' and build.get('projectId') == PROJECT and build.get('region') == REGION,
                'Candidate needs an exact successful regional build receipt')
        owner = 'wms' if key.startswith('wms-') else 'source' if key in (SOURCE, MODULE) else 'erp'
        tag = REGISTRY + IMAGE_KEYS[key] + ':doaf-' + pins[owner]
        require(tag in build.get('images', []) and any(r.get('name') == tag and r.get('digest') == row['image'].split('@')[-1]
                                                       for r in build.get('results', {}).get('images', [])),
                'Successful build does not prove the requested source/digest')
    return {k: v['image'] for k, v in images.items()}


def set_env(container, values=None, secrets=None):
    rows = env_map(container)
    for name, val in (values or {}).items():
        rows[name] = {'name': name, 'value': val}
    for name, ref in (secrets or {}).items():
        rows[name] = {'name': name, 'valueFrom': copy.deepcopy(ref)}
    container['env'] = list(rows.values())


def tagged(origin, tag):
    return origin.replace('https://', 'https://' + tag + '---', 1)


def candidate_specs(baseline, pins, images, stage='review', pairing='candidate'):
    snapshot_guard(baseline)
    require(source_pins(pins['erp'], pins['source'], pins['wms']) == pins and pins['wms'] == WMS_SOURCE,
            'Exact frozen source pins required for candidate')
    require(stage in ('review', 'final') and pairing in ('candidate', 'canonical'), 'Only owned DEV tags/pairings are allowed')
    require(set(images) == set(IMAGE_KEYS), 'Six candidate digests required')
    tag = 'aftersales-' + stage
    tags = {s: 'doa-warehouse-review' if s == WMS else tag for s in DEV}
    urls = {s: tagged(ORIGINS[s], tags[s]) for s in DEV}
    pair = urls if pairing == 'candidate' else ORIGINS
    fingerprint = sha256(canonical({'pins': pins, 'images': images, 'stage': stage, 'pairing': pairing}))[:12]
    result = {}
    for name in DEV:
        spec = portable(baseline[name])
        revision = name + '-doaf-' + fingerprint + ('-c' if stage == 'review' else '-f')
        require(len(revision) <= 63, 'Revision name exceeds Cloud Run bound')
        spec['spec']['template']['metadata']['name'] = revision
        # A Git SHA exceeds label length only when combined; each value is exact
        # and independently attributable (rather than an inferred latest ref).
        labels = spec['spec']['template']['metadata'].setdefault('labels', {})
        labels['corely-erp-source'] = pins['erp']
        labels['corely-aftersales-source'] = pins['source']
        labels['corely-wms-source'] = pins['wms']
        for c, image_key in zip(containers(spec), SERVICE_IMAGES[name]):
            require(images[image_key].startswith(REGISTRY + IMAGE_KEYS[image_key] + '@') and
                    DIGEST.fullmatch(images[image_key].split('@')[-1]), 'Wrong candidate image')
            c['image'] = images[image_key]
            owner = 'wms' if name == WMS else 'source' if name in (SOURCE, MODULE) else 'erp'
            set_env(c, {'SOURCE_VERSION': pins[owner]})
        c = containers(spec)[0]
        if name == API:
            set_env(c, {**REPAIR_VALUES, 'AFTER_SALES_TASK_SOURCE_URL': pair[MODULE] + '/after-sales-app',
                        'WMS_PORTAL_SERVICE_URL': pair[WMS], 'WMS_WORKSPACE_URL': pair[WMS],
                        'CORS_ORIGIN': value(c, 'CORS_ORIGIN')}, NEW_SECRET)
            require(value(c, 'ERP_DEV_MAILROOM_SOURCE_URL') == ORIGINS[SOURCE], 'Mailroom events must keep the canonical normal Source')
        elif name == WEB:
            set_env(c, {'API_URL': pair[API] + '/api/v1', 'WS_URL': pair[API], 'WMS_PORTAL_URL': pair[WMS],
                        'AFTER_SALES_MODULE_URL': pair[MODULE], 'COPILOT_CANDIDATE_WEB_ORIGIN': urls[WEB]})
        elif name in (SOURCE, MODULE):
            set_env(c, {'ERP_INTEGRATION_API_ORIGIN': pair[API]})
            # Preserve NEXTAUTH and public Source roots. Canonical dispatch
            # proof MUST remain normal Source /api, never module-prefixed.
        elif name == WMS:
            set_env(containers(spec)[1], {'ERP_PORTAL_API_URL': pair[API] + '/api/v1'})
        # Splitting an owned tagged row that carries traffic is necessary:
        # keep its old percentage on the old revision, only repoint its tag.
        traffic = []
        for row in spec['spec']['traffic']:
            if row.get('tag') == tags[name]:
                if row.get('percent', 0):
                    retained = copy.deepcopy(row)
                    retained.pop('tag', None)
                    traffic.append(retained)
                continue
            traffic.append(row)
        traffic.append({'revisionName': revision, 'tag': tags[name], 'percent': 0})
        spec['spec']['traffic'] = traffic
        assert_candidate_preserved(baseline[name], spec, tags[name])
        result[name] = spec
    return result, urls


def assert_candidate_preserved(before, after, own_tag):
    require(after['metadata'].get('resourceVersion') == before['metadata']['resourceVersion'], 'CAS version must be retained')
    old = before['spec']['traffic']
    new = after['spec']['traffic']
    def weights(rows):
        result = {}
        for r in rows:
            if r.get('percent', 0):
                result[r['revisionName']] = result.get(r['revisionName'], 0) + r['percent']
        return result
    require(weights(old) == weights(new), 'Candidate changes serving percentages')
    foreign_old = [r for r in old if r.get('tag') != own_tag and r.get('tag')]
    foreign_new = [r for r in new if r.get('tag') != own_tag and r.get('tag')]
    require(foreign_old == foreign_new, 'Foreign traffic tags changed')
    b, a = copy.deepcopy(portable(before)), copy.deepcopy(after)
    b['spec'].pop('traffic', None)
    a['spec'].pop('traffic', None)
    for s in (a, b):
        m = s['spec']['template']['metadata']
        m.pop('name', None)
        for label in ('corely-erp-source', 'corely-aftersales-source', 'corely-wms-source'):
            m.get('labels', {}).pop(label, None)
        if not m.get('labels'):
            m.pop('labels', None)
    allowed_env = {
        API: set(REPAIR_VALUES) | set(NEW_SECRET) | {'SOURCE_VERSION', 'AFTER_SALES_TASK_SOURCE_URL', 'WMS_PORTAL_SERVICE_URL', 'WMS_WORKSPACE_URL'},
        WEB: {'SOURCE_VERSION', 'API_URL', 'WS_URL', 'WMS_PORTAL_URL', 'AFTER_SALES_MODULE_URL', 'COPILOT_CANDIDATE_WEB_ORIGIN'},
        SOURCE: {'SOURCE_VERSION', 'ERP_INTEGRATION_API_ORIGIN'}, MODULE: {'SOURCE_VERSION', 'ERP_INTEGRATION_API_ORIGIN'},
        WMS: {'SOURCE_VERSION', 'ERP_PORTAL_API_URL'},
    }[before['metadata']['name']]
    for original, candidate in zip(containers(b), containers(a)):
        original.pop('image', None)
        candidate.pop('image', None)
        for c in (original, candidate):
            c['env'] = [e for e in c.get('env', []) if e['name'] not in allowed_env]
    require(a == b, 'Candidate changes a non-allowlisted runtime/IAM/secret setting')


def candidate_prepare(baseline, pins, receipt, erp_root, source_root, wms_root, output, stage, pairing):
    clean_checkout(erp_root, pins['erp'])
    clean_checkout(source_root, pins['source'])
    wms_context(wms_root, pins['wms'])
    refs = snapshot_guard(baseline)
    dependencies = package_fingerprints(erp_root, {'api': 'backend', 'web': 'frontend'})
    require(dependencies['api']['storageDeclared'] == STORAGE_VERSION and dependencies['api']['storageResolved'] == STORAGE_VERSION,
            'Candidate requires the exact rebuilt ERP storage dependency')
    dependencies.update(package_fingerprints(source_root, {'source': ''}))
    dependencies.update(package_fingerprints(Path(wms_root) / 'build-source', {'wms-api': 'backend', 'wms-web': 'frontend'}))
    images = build_images(receipt, pins)
    specs, urls = candidate_specs(baseline, pins, images, stage, pairing)
    directory = private_dir(output)
    for name, spec in specs.items():
        private_json(directory / (name + '.service.json'), spec)
    private_json(directory / 'expected-nine-services.private.json', baseline)
    record = {'version': 1, 'mode': 'candidate-prepare-only', 'project': PROJECT, 'region': REGION, 'sourcePins': pins,
              'images': images, 'candidateUrls': urls, 'pairing': pairing,
              'casVersions': {s: baseline[s]['metadata']['resourceVersion'] for s in ALL},
              'existingReferenceAllowlist': refs, 'newSecretReferences': NEW_SECRET,
              'canonicalProofOrigin': ORIGINS[SOURCE], 'moduleBasePath': '/after-sales-app',
              'dependencies': dependencies,
              'migrationChecksums': {'erp': migration_hashes(erp_root, 'backend/prisma/migrations'),
                                     'source': migration_hashes(source_root, 'prisma/migrations')},
              'protectedServicesUnchanged': list(PROTECTED), 'trafficPromoted': False, 'deployed': False,
              'files': file_manifest(directory),
              'replacementOrder': [SOURCE, MODULE, WMS, API, WEB],
              'requiresBeforeEachReplace': ['fresh nine-service snapshot against expected including resourceVersion',
                                            'Root actual CAS replace of one service', 'capture actual resulting snapshot and use as next expected'],
              'requiresBeforeBusinessAcceptance': ['separate migrations receipt matches exact hashes',
                                                   'normal Source canonical promotion completed',
                                                   'new /api/version and compiled dependencies verified',
                                                   'six-case authenticated DEV flow acceptance; no live marketplaces/payment/LINE']}
    private_json(directory / 'candidate-manifest.private.json', record)
    clean_checkout(erp_root, pins['erp'])
    clean_checkout(source_root, pins['source'])
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('prepare-build', 'candidate'):
        p = commands.add_parser(name)
        p.add_argument('--baseline', type=Path, required=True)
        for owner in ('erp', 'source', 'wms'):
            p.add_argument('--' + owner + '-sha', required=True)
            p.add_argument('--' + owner + '-root', type=Path, required=True)
        p.add_argument('--output', type=Path, required=True)
        if name == 'candidate':
            p.add_argument('--images-receipt', type=Path, required=True)
            p.add_argument('--stage', choices=('review', 'final'), default='review')
            p.add_argument('--pairing', choices=('candidate', 'canonical'), default='candidate')
    fresh = commands.add_parser('verify-fresh')
    fresh.add_argument('--expected', type=Path, required=True)
    fresh.add_argument('--observed', type=Path, required=True)
    fresh.add_argument('--output', type=Path, required=True)
    context = commands.add_parser('verify-context')
    context.add_argument('--manifest', type=Path, required=True)
    context.add_argument('--manifest-sha256', required=True)
    proof = commands.add_parser('verify-builds')
    proof.add_argument('--manifest', type=Path, required=True)
    proof.add_argument('--manifest-sha256', required=True)
    proof.add_argument('--build-json', type=Path, action='append', required=True,
                       help='Private {region: asia-east1, description: complete Cloud Build describe JSON}')
    proof.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'verify-context':
        verified, _ = verify_build_context(args.manifest, args.manifest_sha256)
        print(json.dumps({'mode': 'context-readback-only', 'sourcePins': verified['sourcePins'], 'contextSha256': verified['contextSha256']}))
        return
    if args.command == 'verify-builds':
        receipt = success_build_receipt(args.manifest, args.manifest_sha256, args.build_json, args.output)
        print(json.dumps({'mode': 'success-build-readback-only', 'images': len(receipt['images']), 'receipt': str(args.output)}))
        return
    if args.command == 'verify-fresh':
        versions = assert_fresh(read_json(args.expected), read_json(args.observed))
        private_json(args.output, {'version': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
                                  'versions': versions, 'replacementExecuted': False,
                                  'requiresAtomicResourceVersionOnActualReplace': True})
        print(json.dumps({'mode': 'fresh-check-only', 'matchedServices': len(versions), 'receipt': str(args.output)}))
        return
    pins = source_pins(args.erp_sha, args.source_sha, args.wms_sha)
    baseline = read_json(args.baseline)
    if args.command == 'prepare-build':
        result = build_prepare(baseline, pins, args.erp_root, args.source_root, args.wms_root, args.output)
    else:
        result = candidate_prepare(baseline, pins, read_json(args.images_receipt), args.erp_root, args.source_root,
                                   args.wms_root, args.output, args.stage, args.pairing)
    # No environment contents, full baseline or credentials go to console.
    manifest_path = args.output / ('build-manifest.private.json' if args.command == 'prepare-build' else 'candidate-manifest.private.json')
    print(json.dumps({'mode': result['mode'], 'sourcePins': pins, 'output': str(args.output),
                      'manifestPath': str(manifest_path), 'manifestSha256': sha256(manifest_path.read_bytes()), 'deployed': False}))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        raise SystemExit('STOP: ' + str(error))
