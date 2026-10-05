#!/usr/bin/env python3
"""Prepare paired, committed DEV source images. Cloud operations are metadata reads only.
Generated context is private and excludes snapshots and credentials from upload.
An authorized operator must separately submit the printed build command.
"""
import argparse, hashlib, json, os, shutil, subprocess, tempfile
from pathlib import Path
import doa_release as release
AS_BASE='bf1f86efecc51397f2402a3286a6e760b79a3249'
ERP_BASE='ac9c85a7dc39647f7b1eda9ad8ac9cf3b74de962'
REGISTRY=release.REGISTRY
AS_SERVICE='moztech-after-sales-dev'
MODULE_SERVICE='corely-aftersales-module-dev'
NEW_MIGRATIONS=('20261005120000_repair_workflow','20261005130000_aftersales_stock','20261005140000_aftersales_module_permissions','20261005150000_mailroom_source_feed')
def run(args,cwd=None):
 r=subprocess.run(args,cwd=cwd,capture_output=True,text=True)
 release.require(r.returncode==0,'Command failed: '+args[0]+'; sensitive output suppressed')
 return r.stdout.strip()
def clean(repo,base):
 release.require(not run(['git','status','--porcelain'],repo),'Commit source first: '+str(repo))
 sha=run(['git','rev-parse','HEAD'],repo)
 run(['git','merge-base','--is-ancestor',base,sha],repo)
 return sha
def cloudservice(name):
 return json.loads(run(['gcloud','run','services','describe',name,'--project='+release.PROJECT,'--region='+release.REGION,'--format=json']))
def prepare(as_repo,context):
 erp=clean(release.ROOT,ERP_BASE);source=clean(as_repo,AS_BASE)
 release.require(as_repo==release.ROOT.parent/'corely-aftersales-workflow-20261005','Expected owned after-sales worktree')
 erp_live=release.snapshot_all();as_live=cloudservice(AS_SERVICE)
 expected={'corely-erp-api-dev':'corely-erp-api-dev-doa-ac9c85a7dc39-c','corely-erp-dev':'corely-erp-dev-doa-ac9c85a7dc39-f','moztech-after-sales-dev':'moztech-after-sales-dev-search-bf1f86ef'}
 for n,value in {**erp_live,AS_SERVICE:as_live}.items():
  if n in expected: release.require([r.get('revisionName') for r in value['status']['traffic'] if r.get('percent')==100]==[expected[n]],'Serving revision changed; coordinate fresh owner/source review: '+n)
 for n in release.DEV:
  release.guards(erp_live[n]);release.require(release.ready(erp_live[n]),'DEV service not Ready')
 release.require(as_live['spec']['template']['spec']['serviceAccountName']=='moztech-aftersales-dev-rt@moztech-main-db.iam.gserviceaccount.com','Wrong source DEV account')
 env=release.env_map(as_live)
 for key,value in {'AS_MAILROOM_DEV':'true','APP_ENV':'development','RUNTIME_ENV':'dev','CLOUDSQL_INSTANCE':'moztech-main-db:asia-east1:moztech-warranty-dev-db'}.items():
  release.require(env.get(key,{}).get('value')==value,'Source DEV boundary changed: '+key)
 for repo,base,paths in [(release.ROOT,ERP_BASE,['backend/package.json','backend/package-lock.json','frontend/package.json','frontend/package-lock.json','backend/Dockerfile','frontend/Dockerfile','backend/scripts/start-prod.js','backend/scripts/database-url.js','backend/prisma.config.ts','backend/assets']), (as_repo,AS_BASE,['package.json','package-lock.json','scripts/start-dev-cloud-run.sh'])]:
  release.require(not run(['git','diff','--name-only',base,'HEAD','--',*paths],repo),'Unreviewed runtime dependency/startup change')
 run(['node','scripts/dev/generate-copilot-knowledge.cjs','--check'],release.ROOT)
 for name in ['backend','frontend']: run(['npm','run','build'],release.ROOT/name)
 context.mkdir(mode=0o700,exist_ok=False)
 steps=[];images=[]
 baseline={**erp_live,AS_SERVICE:as_live}
 for folder,name in [('backend',release.API),('frontend',release.WEB)]:
  t=context/folder;shutil.copytree(release.ROOT/folder/'dist',t/'dist')
  live=erp_live[name];rev=[x['revisionName']for x in live['status']['traffic'] if x.get('percent')==100]
  release.require(len(rev)==1,'Expected one explicit serving revision')
  revision=release.cloud('revision',rev[0]);image=revision['status']['imageDigest']
  proven=release.build_image(release.cloud('build','7fd2330f-31ef-482f-94db-9be4ea80a9e8'),name,ERP_BASE,historical=True)
  release.require(image==proven,'Approved serving build/source digest changed')
  release.require('@sha256:' in image,'Base image is not immutable')
  docker='FROM '+image+'\nWORKDIR /app\nRUN rm -rf /app/dist\nCOPY dist /app/dist\n'
  if folder=='backend':
   shutil.copytree(release.ROOT/'backend/prisma',t/'prisma');shutil.copyfile(release.ROOT/'backend/scripts/dev-sandbox.cjs',t/'dev-sandbox.cjs')
   docker+='RUN rm -rf /app/prisma\nCOPY prisma /app/prisma\nCOPY dev-sandbox.cjs /app/scripts/dev-sandbox.cjs\nRUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/unconnected?schema=public" ./node_modules/.bin/prisma generate --schema=/app/prisma/schema.prisma\n'
  else:
   shutil.copyfile(release.ROOT/'frontend/server.mjs',t/'server.mjs');docker+='COPY server.mjs /app/server.mjs\n'
  docker+='LABEL org.opencontainers.image.revision="'+erp+'"\n';(t/'Dockerfile').write_text(docker)
  img=REGISTRY+name+':aftersales-'+erp;images.append(img);steps.append({'name':'gcr.io/cloud-builders/docker','dir':folder,'args':['build','-t',img,'.'],'waitFor':['-']})
 archive=context/'source.tar';run(['git','archive','--format=tar','--output='+str(archive),'HEAD'],as_repo)
 t=context/'after-sales';t.mkdir();subprocess.run(['tar','-xf',str(archive),'-C',str(t)],check=True);archive.unlink()
 for name,module in [(AS_SERVICE,'false'),(MODULE_SERVICE,'true')]:
  img=REGISTRY+name+':aftersales-'+source;images.append(img)
  steps.append({'name':'gcr.io/cloud-builders/docker','dir':'after-sales','args':['build','--build-arg','SOURCE_VERSION='+source,'--build-arg','ERP_MODULE_BUILD='+module,'-t',img,'.'],'waitFor':['-']})
 config={'steps':steps,'images':images,'timeout':'1800s','tags':['aftersales-'+erp],'options':{'machineType':'E2_HIGHCPU_8','logging':'CLOUD_LOGGING_ONLY'}}
 release.private_json(context/'cloudbuild.json',config)
 release.private_json(context/'manifest.json',{'erpSha':erp,'afterSalesSha':source,'baseline':baseline,'migrations':{n:release.digest_file(release.ROOT/'backend/prisma/migrations'/n/'migration.sql')for n in NEW_MIGRATIONS},'images':images})
 (context/'.gcloudignore').write_text('manifest.json\ncontext-receipt.json\n.gcloudignore\nafter-sales/.env*\n')
 release.private_json(context/'context-receipt.json',{'erpSha':erp,'afterSalesSha':source,'files':{str(f.relative_to(context)):hashlib.sha256(f.read_bytes()).hexdigest()for f in context.rglob('*') if f.is_file() and f.name not in ['manifest.json','context-receipt.json']}})
 print(json.dumps({'context':str(context),'erpSha':erp,'afterSalesSha':source,'images':images,'mode':'plan-only'}))
 print('gcloud builds submit '+str(context)+' --project='+release.PROJECT+' --region=global --config='+str(context/'cloudbuild.json')+' --async --format=value(id)')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--after-sales-repo',type=Path,required=True);parser.add_argument('--context',type=Path,required=True);args=parser.parse_args();prepare(args.after_sales_repo.resolve(),args.context.resolve())
