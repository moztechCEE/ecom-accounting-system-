"""Package reviewed SN dist on the exact currently approved DEV runtime images.
Adds only QR/barcode dependencies in a separate locked module directory.
"""
import json,shutil,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[2]
assert not subprocess.check_output(['git','status','--porcelain'],cwd=root).strip(),'Commit reviewed source before build'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()
registry='asia-east1-docker.pkg.dev/moztech-main-db/cloud-run/'
bases={'backend':('corely-erp-api-dev','6ecf1c792716faeead87ed89945b96f61969fc786e3b166f326628498ab0ea05'),'frontend':('corely-erp-dev','f508452e2cf5da4951d258e89a34c02513e1532aa71c643070cfcf315eb0825a')}
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
