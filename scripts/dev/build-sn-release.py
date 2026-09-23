"""Package reviewed SN dist on the exact currently approved DEV runtime images.
Adds only QR/barcode dependencies in a separate locked module directory.
"""
import json,shutil,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip(),'Commit reviewed source before build'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()
registry='asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/'
bases={'backend':('corely-erp-api-dev','a137b99bc82b48f12de0ac06fda20cdfe762f15c11b87ed4983281f932a84236'),'frontend':('corely-erp-dev','402a73a0c489446fe2e1cfb223298e25d65a5c9c6b39fd3284f4e9b9a13d080b')}
for service,digest in bases.values():
 live=json.loads(subprocess.check_output(['gcloud','run','services','describe',service,'--project=moztech-main-db','--region=asia-east1','--format=json'],stderr=subprocess.DEVNULL))
 traffic=[t for t in live['status']['traffic'] if t.get('percent',0)]
 assert len(traffic)==1 and traffic[0]['percent']==100, 'DEV traffic changed; review before build'
 revision=json.loads(subprocess.check_output(['gcloud','run','revisions','describe',traffic[0]['revisionName'],'--project=moztech-main-db','--region=asia-east1','--format=json'],stderr=subprocess.DEVNULL))
 assert revision['status']['imageDigest'].endswith(digest), 'DEV base changed; review other work before build'
with tempfile.TemporaryDirectory(prefix='sn-dev-release-') as temp:
 ctx=Path(temp);steps=[];images=[]
 for folder,(service,digest) in bases.items():
  target=ctx/folder;shutil.copytree(root/folder/'dist',target/'dist')
  docker=f'FROM {registry}{service}@sha256:{digest}\nCOPY dist /app/dist\n'
  if folder=='backend':
   shutil.copytree(root/'backend/assets',target/'assets');shutil.copytree(root/'scripts/dev/sn-runtime-deps',target/'sn-runtime-deps')
   docker+='COPY assets /app/assets\nCOPY sn-runtime-deps /opt/sn-deps\nRUN cd /opt/sn-deps && npm ci --omit=dev --ignore-scripts --no-audit --no-fund\nENV NODE_PATH=/opt/sn-deps/node_modules\n'
  docker+=f'LABEL org.opencontainers.image.revision="{sha}"\n'
  (target/'Dockerfile').write_text(docker);image=registry+service+':sn-'+sha;images.append(image)
  steps.append({'name':'gcr.io/cloud-builders/docker','dir':folder,'args':['build','-t',image,'.'],'waitFor':['-']})
 config={'steps':steps,'images':images,'timeout':'1800s','options':{'logging':'CLOUD_LOGGING_ONLY'}}
 (ctx/'cloudbuild.json').write_text(json.dumps(config))
 subprocess.run(['gcloud','builds','submit',str(ctx),'--project=moztech-main-db','--config='+str(ctx/'cloudbuild.json'),'--async','--format=value(id)'],check=True)
