"""Run SN acceptance in a disposable schema of DEV; never connect to production DB."""
import json, os, subprocess, sys, urllib.parse, uuid
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def cloud(*args): return subprocess.check_output(['gcloud',*args,'--project=moztech-main-db'],stderr=subprocess.DEVNULL).decode().strip()
s=json.loads(cloud('run','services','describe','corely-erp-api-dev','--region=asia-east1','--format=json'))
env={v['name']:v for v in s['spec']['template']['spec']['containers'][0]['env']}
assert env['DB_NAME']['value']=='erp_dev_20260921' and env['DB_USER']['value']=='erp_dev_runtime'
v=env['DB_PASSWORD'];password=v.get('value')
if password is None:
 ref=v['valueFrom']['secretKeyRef'];password=cloud('secrets','versions','access',ref['key'],'--secret='+ref['name'])
pg={**os.environ,'PGHOST':'127.0.0.1','PGPORT':'15442','PGDATABASE':'erp_dev_20260921','PGUSER':'erp_dev_runtime','PGPASSWORD':password}
psql='/opt/homebrew/opt/libpq/bin/psql'
def sql(text,extra={}):
 r=subprocess.run([psql,'-X','-v','ON_ERROR_STOP=1','-q'],input=text,text=True,capture_output=True,env={**pg,**extra})
 if r.returncode: raise RuntimeError(r.stderr[:1500])
mode=sys.argv[1]
schema='sn_acceptance_'+uuid.uuid4().hex if mode=='test' else 'public'
url='postgresql://erp_dev_runtime:'+urllib.parse.quote(password,safe='')+'@127.0.0.1:15442/erp_dev_20260921?schema='+schema
migration=root/'backend/prisma/migrations/20260922000000_sn_labels/migration.sql'
if mode=='test':
 admin=json.loads(cloud('run','revisions','describe','ecom-accounting-backend-00506-ray','--region=asia-east1','--format=json'))
 ae={v['name']:v for v in admin['spec']['containers'][0]['env']};ap=ae['DB_PASSWORD'].get('value')
 if ap is None:
  ref=ae['DB_PASSWORD']['valueFrom']['secretKeyRef'];ap=cloud('secrets','versions','access',ref['key'],'--secret='+ref['name'])
 owner={'PGUSER':ae['DB_USER']['value'],'PGPASSWORD':ap}
 sql('CREATE SCHEMA '+schema+'; GRANT USAGE, CREATE ON SCHEMA '+schema+' TO erp_dev_runtime;',owner)
 try:
  sql(migration.read_text()+'\nCREATE TABLE products (LIKE public.products INCLUDING DEFAULTS);',{'PGOPTIONS':'-c search_path='+schema})
  subprocess.run(['node','test/sn-integration.cjs'],cwd=root/'backend',env={**os.environ,'DATABASE_URL':url,'SN_TEST_SCHEMA':schema},check=True)
 finally:
  sql('DROP SCHEMA '+schema+' CASCADE;',owner)
elif mode=='migrate':
 # Add only this reviewed migration; don't deploy unrelated historical migrations.
 sql('BEGIN;\n'+migration.read_text()+'\nCOMMIT;')
 subprocess.run(['node_modules/.bin/prisma','migrate','resolve','--applied','20260922000000_sn_labels'],cwd=root/'backend',env={**os.environ,'DATABASE_URL':url},check=True)
 print('DEV SN schema migration recorded. No production connection.',flush=True)
elif mode=='inspect':
 r=subprocess.run([psql,'-X','-At','-c',"SELECT nspname FROM pg_namespace WHERE nspname LIKE 'sn_acceptance_%' ORDER BY nspname"],env=pg,capture_output=True,text=True,check=True)
 print(r.stdout)
else: raise SystemExit('Expected test, migrate or inspect')
