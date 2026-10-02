#!/usr/bin/env python3
"""Prepare a reviewable ERP DEV build; PLAN ONLY, no cloud writes.

After the latest DEV source is merged and all reviewed changes are committed:
  python3 scripts/dev/build-doa-release.py \
    --api-live-source-sha FULL_SHA --api-live-build-id UUID \
    --web-live-source-sha FULL_SHA --web-live-build-id UUID --context-dir /tmp/erp-doa-build

This dynamically snapshots the serving API/web and all protected services.
It preserves existing Ready tagged zero-traffic candidates and refuses unready
concurrent candidates, changed runtime dependencies, missing serving-source
ancestry, knowledge drift, or unreviewed migrations. Local build
outputs and a private immutable-base image context are generated. Before an
independently authorized submission, recheck that exact context with:
  python3 scripts/dev/build-doa-release.py --verify-context /tmp/erp-doa-build

The emitted command is a proposal, not an execution. Save the build ID outside
this context. There is intentionally no --submit or --execute option. This does
not read credentials, connect to databases, run migrations or enable WMS flags.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

import doa_release as release


def submission(context, manifest):
    command = ['gcloud', 'builds', 'submit', str(context), '--project=' + release.PROJECT,
               '--region=' + release.BUILD_REGION, '--config=' + str(context / 'cloudbuild.json'), '--async', '--format=value(id)']
    return {'mode': 'plan-only', 'submitted': False, 'sourceSha': manifest['sourceSha'],
            'context': str(context), 'manifestSha256': release.digest_file(context / 'manifest.json'),
            'images': manifest['images'], 'proposedCommand': shlex.join(command),
            'requiresFreshVerificationBeforeExternalExecution': True}


def prepare(context_path, evidence):
    source = release.clean_source()
    release.verify_source(source, {name: row['sourceSha'] for name, row in evidence.items()})
    baseline = release.capture_baseline(evidence)
    # These tools never receive a DEV/prod database URL. Prisma validate/generate
    # do not connect; migrations are performed separately with a scoped receipt.
    runtime = {**os.environ, 'DATABASE_URL': 'postgresql://build:build@127.0.0.1:5432/unconnected?schema=public'}
    subprocess.run(['node', 'scripts/dev/generate-copilot-knowledge.cjs', '--check'], cwd=release.ROOT, check=True)
    for command in ('validate', 'generate'):
        subprocess.run(['node_modules/.bin/prisma', command, '--schema=prisma/schema.prisma'],
                       cwd=release.ROOT / 'backend', env=runtime, check=True)
    for folder in ('backend', 'frontend'):
        subprocess.run(['npm', 'run', 'build'], cwd=release.ROOT / folder, env=runtime, check=True)
    release.require(release.clean_source() == source, 'Source changed during compilation')
    release.assert_snapshot(baseline['services'], release.snapshot_all())
    context = (release.private_directory(context_path, new=True) if context_path else
               Path(tempfile.mkdtemp(prefix='erp-doa-handover-build-')))
    steps, images = [], []
    for folder, name in (('backend', release.API), ('frontend', release.WEB)):
        target = context / folder
        shutil.copytree(release.ROOT / folder / 'dist', target / 'dist', symlinks=True)
        docker = f"FROM {baseline['images'][name]}\nWORKDIR /app\nRUN rm -rf /app/dist\nCOPY dist /app/dist\n"
        if folder == 'backend':
            shutil.copytree(release.ROOT / 'backend/prisma', target / 'prisma', symlinks=True)
            shutil.copyfile(release.ROOT / 'backend/scripts/dev-sandbox.cjs', target / 'dev-sandbox.cjs')
            docker += ('RUN rm -rf /app/prisma\nCOPY prisma /app/prisma\n'
                       'COPY dev-sandbox.cjs /app/scripts/dev-sandbox.cjs\n'
                       'RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/unconnected?schema=public" '
                       './node_modules/.bin/prisma generate --schema=/app/prisma/schema.prisma\n')
        else:
            shutil.copyfile(release.ROOT / 'frontend/server.mjs', target / 'server.mjs')
            docker += 'COPY server.mjs /app/server.mjs\n'
        docker += f'LABEL org.opencontainers.image.revision="{source}"\n'
        (target / 'Dockerfile').write_text(docker)
        image = release.REGISTRY + name + ':doa-' + source
        images.append(image)
        steps.append({'name': 'gcr.io/cloud-builders/docker', 'dir': folder,
                      'args': ['build', '-t', image, '.'], 'waitFor': ['-']})
    config = {'steps': steps, 'images': images, 'timeout': '1800s',
              'tags': ['doa-' + source], 'options': {'logging': 'CLOUD_LOGGING_ONLY'}}
    release.private_json(context / 'cloudbuild.json', config)
    # Keep complete private service snapshots in the local manifest only.
    # Cloud Build receives compiled image material and its build config.
    (context / '.gcloudignore').write_text('.gcloudignore\nmanifest.json\n')
    manifest = {'version': 1, 'project': release.PROJECT, 'region': release.REGION,
                'createdAt': release.timestamp(), 'sourceSha': source, 'devOnly': True,
                'baseline': baseline, 'images': images, 'migrationChecksums': release.MIGRATIONS,
                'prerequisiteMigrationChecksums': release.PREREQUISITE_MIGRATIONS,
                'reviewedRuntimeFiles': {p: release.digest_file(release.ROOT / p) for p in release.REVIEWED_RUNTIME_FILES},
                'checks': ['clean-committed-source', 'live-source-ancestry', 'unchanged-runtime',
                           'knowledge-check', 'prisma-validate-generate', 'backend-build', 'frontend-build'],
                'filesSha256': release.files_manifest(context),
                'doesNotSubmitDeployOrMigrate': True}
    release.private_json(context / 'manifest.json', manifest)
    release.verify_context(context)
    return context, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for label in ('api', 'web'):
        parser.add_argument('--' + label + '-live-source-sha')
        parser.add_argument('--' + label + '-live-build-id')
        parser.add_argument('--' + label + '-live-build-region', choices=release.SERVING_BUILD_REGIONS,
                            default=release.BUILD_REGION, help='Historical serving build region (default: global)')
    parser.add_argument('--context-dir', type=Path)
    parser.add_argument('--verify-context', type=Path)
    args = parser.parse_args()
    if args.verify_context:
        release.require(not (args.context_dir or args.api_live_source_sha or args.api_live_build_id or args.web_live_source_sha or args.web_live_build_id),
                        '--verify-context cannot be mixed with preparation arguments')
        release.require(args.api_live_build_region == release.BUILD_REGION and args.web_live_build_region == release.BUILD_REGION,
                        '--verify-context reuses pinned manifest build regions; do not override them')
        context = release.private_directory(args.verify_context)
        manifest = release.verify_context(context)
        release.require(release.clean_source() == manifest['sourceSha'], 'Checkout differs from prepared source')
        release.verify_source(manifest['sourceSha'], {name: row['sourceSha'] for name, row in manifest['baseline']['servingEvidence'].items()})
        release.assert_snapshot(manifest['baseline']['services'], release.snapshot_all())
    else:
        release.require(args.api_live_source_sha and args.api_live_build_id and args.web_live_source_sha and args.web_live_build_id,
                        'Preparation needs independently verified API and web serving source/builds')
        evidence = {release.API: {'sourceSha': args.api_live_source_sha, 'buildId': args.api_live_build_id,
                                 'buildRegion': args.api_live_build_region},
                    release.WEB: {'sourceSha': args.web_live_source_sha, 'buildId': args.web_live_build_id,
                                 'buildRegion': args.web_live_build_region}}
        context, manifest = prepare(args.context_dir, evidence)
    print(json.dumps(submission(context, manifest), indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit('STOP: ' + str(error))
