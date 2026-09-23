#!/usr/bin/env python3
"""Prepare a DEV-only build on the reviewed, currently serving SSO images.

Default: verify the checkout/cloud baseline, rebuild local dist, and write a
reviewable build context. Add --submit to submit that exact context to Cloud Build.
Never deploys, migrates a database, changes IAM, reads secrets, or switches traffic.

Examples (after merging SSO, reviewing, generating Prisma locally and committing):
  python3 scripts/dev/build-access-expense-ai-release.py
  python3 scripts/dev/build-access-expense-ai-release.py --submit

The generated images still require an independently reviewed DEV migration and
zero-traffic candidate deployment. Do not use the legacy deploy-built.sh wrapper.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

PROJECT = 'moztech-main-db'
REGION = 'asia-east1'
REGISTRY = f'{REGION}-docker.pkg.dev/{PROJECT}/cloud-run/'
SSO_SOURCE = '707021711816c351cab021e5a265df48d08dd5de'
BASES = {
    'backend': {
        'service': 'corely-erp-api-dev',
        'revision': 'corely-erp-api-dev-account-sso2-0923',
        'digest': 'sha256:7de1f261014cfe50d6c85e41dba6733b906fb1c38c9eab657df3f5f6e95680c8',
    },
    'frontend': {
        'service': 'corely-erp-dev',
        'revision': 'corely-erp-dev-account-sso2-0923',
        'digest': 'sha256:d5b12ba596235b08df9ee695009e6c4a08eb56984628a329a2e7de4732a00102',
    },
}
UNCHANGED_RUNTIME = [
    'backend/package.json', 'backend/package-lock.json', 'frontend/package.json',
    'frontend/package-lock.json', 'backend/Dockerfile', 'frontend/Dockerfile',
    'backend/scripts/start-prod.js', 'backend/scripts/database-url.js',
    'backend/prisma.config.ts', 'frontend/server.mjs', 'backend/assets',
]
ROOT = Path(__file__).resolve().parents[2]


def check(condition, message):
    if not condition:
        raise SystemExit(message)


def output(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.DEVNULL).decode().strip()


def cloud_json(*args):
    return json.loads(output(['gcloud', *args, '--project=' + PROJECT, '--format=json']))


def sha256_file(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_release_state(path):
    if path is None:
        return None
    check(not (path.parent / 'pending.json').exists(), 'Previous deployment has an unresolved mutation')
    state = json.loads(path.read_text())
    check(state.get('version') == 1 and state.get('project') == PROJECT and state.get('region') == REGION,
          'Previous release state is for another environment')
    check([item.get('phase') for item in state.get('completed', [])] == ['candidate-api', 'candidate-web'],
          'Rebuild state must contain only the two completed candidates, before final web or promotion')
    return state


def cloud_baseline(release_state=None):
    snapshots = {}
    for folder, expected in BASES.items():
        name = expected['service']
        service = cloud_json('run', 'services', 'describe', name, '--region=' + REGION)
        active = [item for item in service['status']['traffic'] if item.get('percent', 0)]
        check(len(active) == 1 and active[0].get('percent') == 100 and
              active[0].get('revisionName') == expected['revision'],
              f'{name}: active DEV revision changed; review other work before rebuilding')
        if release_state:
            recorded = release_state['expected'][name]
            check(service['metadata'].get('uid') == recorded['metadata'].get('uid') and
                  service['spec'] == recorded['spec'], f'{name}: previous candidate configuration changed')
            for field in ('latestReadyRevisionName', 'latestCreatedRevisionName'):
                check(service['status'].get(field) == recorded['status'].get(field),
                      f'{name}: previous candidate {field} changed')
            check(any(c.get('type') == 'Ready' and c.get('status') == 'True'
                      for c in service['status'].get('conditions', [])), f'{name}: candidate is not Ready')
        else:
            check(service['status'].get('latestReadyRevisionName') == expected['revision'],
                  f'{name}: another ready candidate exists; coordinate before rebuilding')
        revision = cloud_json('run', 'revisions', 'describe', expected['revision'], '--region=' + REGION)
        image = REGISTRY + name + '@' + expected['digest']
        check(revision['status'].get('imageDigest') == image, f'{name}: reviewed image digest changed')
        check(release_state or service['spec']['template']['spec']['containers'][0]['image'] == image,
              f'{name}: service template no longer matches reviewed active image')
        if folder == 'backend':
            env = {item['name']: item.get('value') for item in revision['spec']['containers'][0].get('env', [])}
            for key, required in {'ERP_DEV_SANDBOX': 'true', 'DB_NAME': 'erp_dev_20260921',
                                  'DB_USER': 'erp_dev_runtime', 'SEED_ON_STARTUP': 'false',
                                  'RUNTIME_SCHEDULES_ENABLED': 'false'}.items():
                check(env.get(key) == required, f'{name}: DEV protection {key} changed')
        snapshots[name] = {
            'revision': expected['revision'], 'image': image,
            'specSha256': hashlib.sha256(json.dumps(service['spec'], sort_keys=True).encode()).hexdigest(),
            'latestReadyRevisionName': service['status'].get('latestReadyRevisionName'),
            'latestCreatedRevisionName': service['status'].get('latestCreatedRevisionName'),
        }
    return snapshots


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--submit', action='store_true', help='Submit Cloud Build after preparing; never deploy')
    parser.add_argument('--context-dir', type=Path, help='New directory for reviewable build context; defaults to a new temp directory')
    parser.add_argument('--release-state', type=Path, help='Previous helper state.json with two zero-traffic candidates and SSO2 still at 100%%')
    args = parser.parse_args()
    check(not output(['git', 'status', '--porcelain']), 'Commit reviewed source first; working tree must be clean')
    sha = output(['git', 'rev-parse', 'HEAD'])
    release_state = load_release_state(args.release_state)
    if release_state:
        check(subprocess.run(['git', 'merge-base', '--is-ancestor', release_state['sourceSha'], sha], cwd=ROOT,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0,
              'The retry source must retain the previous candidate source')
    check(subprocess.run(['git', 'merge-base', '--is-ancestor', SSO_SOURCE, sha], cwd=ROOT,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0,
          'Merge the reviewed latest SSO source before building; never replace it with the older ERP baseline')
    check(not output(['git', 'diff', SSO_SOURCE, '--', *UNCHANGED_RUNTIME]),
          'Dependencies/startup/assets/server changed: this reviewed overlay is insufficient; use a newly reviewed full build')
    # Prisma normalizes schema formatting in the generated copy, so byte equality
    # is not a reliable freshness check. Generate from the exact source instead.
    subprocess.run(['node_modules/.bin/prisma', 'generate', '--schema=prisma/schema.prisma'],
                   cwd=ROOT / 'backend', check=True,
                   env={**os.environ, 'DATABASE_URL': 'postgresql://build:build@127.0.0.1:5432/unconnected?schema=public'})
    before = cloud_baseline(release_state)

    # Rebuild rather than trusting an old untracked dist directory.
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'backend', check=True)
    subprocess.run(['npm', 'run', 'build'], cwd=ROOT / 'frontend', check=True)
    check(output(['git', 'rev-parse', 'HEAD']) == sha and not output(['git', 'status', '--porcelain']),
          'Source changed during local compilation; review and start again')
    check(cloud_baseline(release_state) == before, 'DEV configuration changed during compilation; coordinate and start again')

    if args.context_dir:
        context = args.context_dir.expanduser().resolve()
        check(not context.exists(), 'Refusing to overwrite an existing build context')
        context.mkdir(parents=True, mode=0o700)
    else:
        context = Path(tempfile.mkdtemp(prefix='erp-access-expense-ai-dev-'))
    steps, images = [], []
    for folder, expected in BASES.items():
        target = context / folder
        shutil.copytree(ROOT / folder / 'dist', target / 'dist')
        docker = f"FROM {REGISTRY}{expected['service']}@{expected['digest']}\n"
        docker += 'RUN rm -rf /app/dist\nCOPY dist /app/dist\n'
        if folder == 'backend':
            # Schema/migrations and Linux Prisma client must agree with the reviewed source.
            # The placeholder is scoped to generation; it cannot connect to DEV or production.
            shutil.copytree(ROOT / 'backend/prisma', target / 'prisma')
            shutil.copyfile(ROOT / 'backend/scripts/dev-sandbox.cjs', target / 'dev-sandbox.cjs')
            docker += ('COPY prisma /app/prisma\n'
                       'COPY dev-sandbox.cjs /app/scripts/dev-sandbox.cjs\n'
                       'RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/unconnected?schema=public" '
                       './node_modules/.bin/prisma generate --schema=/app/prisma/schema.prisma\n')
        docker += f'LABEL org.opencontainers.image.revision="{sha}"\n'
        (target / 'Dockerfile').write_text(docker)
        image = REGISTRY + expected['service'] + ':access-expense-ai-' + sha
        images.append(image)
        steps.append({'name': 'gcr.io/cloud-builders/docker', 'dir': folder,
                      'args': ['build', '-t', image, '.'], 'waitFor': ['-']})
    config = {'steps': steps, 'images': images, 'timeout': '1800s', 'options': {'logging': 'CLOUD_LOGGING_ONLY'}}
    (context / 'cloudbuild.json').write_text(json.dumps(config, indent=2) + '\n')
    manifest = {
        'sourceSha': sha, 'requiredSsoSource': SSO_SOURCE, 'devOnly': True,
        'baseline': before, 'images': images,
        'previousCandidateSource': release_state['sourceSha'] if release_state else None,
        'filesSha256': {str(file.relative_to(context)): sha256_file(file)
                        for file in sorted(context.rglob('*')) if file.is_file()},
        'doesNotDeployOrMigrate': True,
    }
    (context / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'context': str(context), 'sourceSha': sha, 'submitted': False, 'images': images}))
    if args.submit:
        check(output(['git', 'rev-parse', 'HEAD']) == sha and not output(['git', 'status', '--porcelain']),
              'Source changed after packaging; refusing submission')
        check(cloud_baseline(release_state) == before, 'DEV configuration changed after packaging; refusing submission')
        for relative, expected in manifest['filesSha256'].items():
            check(sha256_file(context / relative) == expected, 'Prepared build content changed: ' + relative)
        build_id = output(['gcloud', 'builds', 'submit', str(context), '--project=' + PROJECT,
                           '--config=' + str(context / 'cloudbuild.json'), '--async', '--format=value(id)'])
        (context / 'build-id.txt').write_text(build_id + '\n')
        print(json.dumps({'buildId': build_id, 'context': str(context), 'sourceSha': sha, 'submitted': True}))


if __name__ == '__main__':
    main()
