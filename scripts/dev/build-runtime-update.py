"""Build a DEV code update on verified runtime images, with unchanged dependencies.
The caller must build both dist directories and commit the source first.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
baseline = '0ec36da1f6f9c2403d67958d48e5cdc4afe360ae'
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=root).strip(), 'Commit reviewed source first'
assert not subprocess.check_output(['git', 'diff', baseline, '--', 'backend/package-lock.json', 'frontend/package-lock.json', 'backend/prisma', 'backend/scripts', 'frontend/server.mjs'], cwd=root).strip(), 'Dependency/runtime/schema change requires a full build'
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root).decode().strip()
base = 'asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/'
images = {
    'backend': ('corely-erp-api-dev', 'sha256:76b701bcc03dacac1201ca86ce6c59d40e797ff16b6952d40eafccef5b7f202a'),
    'frontend': ('corely-erp-dev', 'sha256:33155738d92adc95cab01194e32601f57abbc33262dd6150e8ef42944977bf31'),
}
with tempfile.TemporaryDirectory(prefix='erp-dev-runtime-update-') as temporary:
    context = Path(temporary)
    steps, built = [], []
    for directory, (service, digest) in images.items():
        target = context / directory
        shutil.copytree(root / directory / 'dist', target / 'dist')
        (target / 'Dockerfile').write_text(f'FROM {base}{service}@{digest}\nCOPY dist /app/dist\nLABEL org.opencontainers.image.revision="{sha}"\n')
        image = base + service + ':' + sha
        built.append(image)
        steps.append({'name': 'gcr.io/cloud-builders/docker', 'dir': directory, 'args': ['build', '-t', image, '.'], 'waitFor': ['-']})
    config = {'steps': steps, 'images': built, 'timeout': '1800s', 'options': {'logging': 'CLOUD_LOGGING_ONLY'}}
    (context / 'build.json').write_text(json.dumps(config))
    subprocess.run(['gcloud', 'builds', 'submit', str(context), '--project=moztech-main-db', '--config=' + str(context / 'build.json'), '--async', '--format=value(id)'], check=True)
