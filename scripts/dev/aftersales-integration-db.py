#!/usr/bin/env python3
"""Inspect/apply only the reviewed ERP/source DEV integration migrations.
No production connection, caller-defined database, seed or real role assignment.
SQL and Prisma ledger are committed together, with an unchanged ledger guard.
Secrets are captured in memory, never printed or placed in repository artifacts.
"""
import argparse,hashlib,importlib.util,json,os,subprocess,uuid
from pathlib import Path
from urllib.parse import urlparse,unquote
ROOT=Path(__file__).resolve().parents[2]
AS_ROOT=ROOT.parent/'corely-aftersales-workflow-20261005'
PROJECT='moztech-main-db'
HASHES={'erp': {'20261005120000_repair_workflow': '7739441893965a2a98dec1ce12fadbca52fb04667e0f1fc6f24350d78e04537b', '20261005130000_aftersales_stock': '01a3ebc11179e8c879f17d8332152f471dfab9861d47db550ce917598610ce34', '20261005140000_aftersales_module_permissions': '557f7eb7909b14a4b2d1d63b081597bfe8afc452bb7e381a08c63c2b3a2ebd61', '20261005150000_mailroom_source_feed': '34a7cd6528527f78516c8cdb8f2471e5805b41df3fa72086e2eb7072f41df8de'}, 'source': {'20261005120000_repair_quote_binding': '7caadaa9ffcb22d8e3557ee44982b75fa928f6c5ffd8c872de8b72611616e93f', '20261005150000_case_change_feed': '834d9108b94c2ebb2b42cb35d513768b4e868ac7c9f3cff2fc11ad24ce917b11', '20261005160000_payment_request_snapshot': '277e5d39de2970e56e342e614d30373f968fada5d8fa40ef12da705c04e94d1d'}}
PSQL='/opt/homebrew/opt/libpq/bin/psql'
def require(condition,message):
 if not condition: raise RuntimeError(message)
def run(args,env=None,input=None):
 r=subprocess.run(args,capture_output=True,text=True,env=env,input=input)
 require(r.returncode==0,'DEV operation failed; sensitive SQL/credential output suppressed')
 return r.stdout.strip()
def quote(s):return "'"+str(s).replace("'","''")+"'"
def connection(which):
 if which=='erp':
  spec=importlib.util.spec_from_file_location('baseguard',ROOT/'scripts/dev/doa-release-db.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  return m.connection(),'erp_dev_20260921','erp_dev_runtime'
 v=json.loads(run(['gcloud','run','services','describe','moztech-after-sales-dev','--region=asia-east1','--project='+PROJECT,'--format=json']))
 template=v['spec']['template'];require(template['spec']['serviceAccountName']=='moztech-aftersales-dev-rt@moztech-main-db.iam.gserviceaccount.com','Wrong source runtime identity')
 values={i['name']:i for i in template['spec']['containers'][0]['env']}
 for k,value in {'AS_MAILROOM_DEV':'true','APP_ENV':'development','RUNTIME_ENV':'dev','CLOUDSQL_INSTANCE':'moztech-main-db:asia-east1:moztech-warranty-dev-db'}.items():require(values.get(k,{}).get('value')==value,'Source is not isolated DEV')
 ref=values['DATABASE_URL']['valueFrom']['secretKeyRef'];require('dev' in ref['name'].lower(),'Expected dedicated DEV credential')
 u=urlparse(run(['gcloud','secrets','versions','access',ref['key'],'--secret='+ref['name'],'--project='+PROJECT]))
 require(u.path=='/moztech_after_sales_dev' and unquote(u.username)=='moztech_aftersales_dev','Refusing non-DEV DB credentials')
 env={k:v for k,v in os.environ.items()if not k.startswith('PG') and k!='DATABASE_URL'}
 env.update(PGHOST='127.0.0.1',PGPORT='15443',PGDATABASE='moztech_after_sales_dev',PGUSER='moztech_aftersales_dev',PGPASSWORD=unquote(u.password),PGCONNECT_TIMEOUT='10')
 return env,'moztech_after_sales_dev','moztech_aftersales_dev'
def sql(s,env):return run([PSQL,'-X','-w','-Atq','-v','ON_ERROR_STOP=1'],env,s)
def data(s,env):return json.loads(sql("BEGIN READ ONLY;SELECT COALESCE(json_agg(row_to_json(q)),'[]'::json) FROM ("+s+")q;COMMIT;",env))
def inspect(which,env):
 repo=ROOT if which=='erp' else AS_ROOT
 identity=data('SELECT current_database() database,current_user db_user',env)[0]
 require(identity=={'database':env['PGDATABASE'],'db_user':env['PGUSER']},'Unexpected connected database')
 ledger=data('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY started_at,id',env)
 require(not any(not r['finished_at'] and not r['rolled_back_at']for r in ledger),'Unfinished migration exists')
 active={r['migration_name']:r['checksum']for r in ledger if r['finished_at'] and not r['rolled_back_at']}
 local={x.parent.name for x in (repo/('backend/prisma/migrations'if which=='erp'else'prisma/migrations')).glob('*/migration.sql')}
 require(not set(active)-local,'Missing applied source migration')
 pending=local-set(active);require(pending.issubset(HASHES[which]),'Unrelated pending migration; stop')
 root=repo/('backend/prisma/migrations'if which=='erp'else'prisma/migrations')
 for n,h in HASHES[which].items():
  require(hashlib.sha256((root/n/'migration.sql').read_bytes()).hexdigest()==h,'Reviewed migration changed')
  require(n not in active or active[n]==h,'Migration checksum differs')
 return repo,root,active,pending
LEDGER="md5(COALESCE((SELECT string_agg(migration_name||':'||checksum||':'||COALESCE(finished_at::text,'')||':'||COALESCE(rolled_back_at::text,''),E'\n' ORDER BY migration_name,checksum,started_at,id) FROM _prisma_migrations),''))"
def apply(which,receipt):
 env,database,user=connection(which);repo,root,active,pending=inspect(which,env)
 sha=run(['git','-C',str(repo),'rev-parse','HEAD'])
 require(not run(['git','-C',str(repo),'status','--porcelain']),'Commit reviewed source before migration')
 before_roles=data("SELECT md5(COALESCE(string_agg(user_id||':'||role_id,',' ORDER BY user_id,role_id),'')) hash FROM user_roles",env)if which=='erp' else None
 for n,h in HASHES[which].items():
  if n not in pending:continue
  fingerprint=data('SELECT '+LEDGER+' hash',env)[0]['hash']
  body=(root/n/'migration.sql').read_text()
  statement="BEGIN;SET LOCAL lock_timeout='10s';SET LOCAL statement_timeout='60s';SELECT pg_advisory_xact_lock(20261006,1600);LOCK TABLE _prisma_migrations IN SHARE ROW EXCLUSIVE MODE;DO $$BEGIN IF ("+LEDGER+")<>"+quote(fingerprint)+" THEN RAISE EXCEPTION 'migration_history_changed'; END IF;IF current_database()<>"+quote(database)+" OR current_user<>"+quote(user)+" THEN RAISE EXCEPTION 'wrong_dev_database';END IF;END;$$;"+body+"INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count)VALUES("+quote(uuid.uuid4())+","+quote(h)+",NOW(),"+quote(n)+",NOW(),1);COMMIT;"
  sql(statement,env);_,_,applied,_=inspect(which,env);require(applied.get(n)==h,'Committed migration verification failed; do not replay SQL')
 _,_,active,left=inspect(which,env);require(not left,'Pending migration remains')
 if which=='erp':require(before_roles==data("SELECT md5(COALESCE(string_agg(user_id||':'||role_id,',' ORDER BY user_id,role_id),'')) hash FROM user_roles",env),'User role assignment changed')
 require(run(['git','-C',str(repo),'rev-parse','HEAD'])==sha,'Source changed while applying')
 receipt.parent.mkdir(parents=True,exist_ok=True);receipt.write_text(json.dumps({'sourceSha':sha,'database':database,'dbUser':user,'migrations':HASHES[which],'applied':True,'userRolesPreserved':True},indent=2));receipt.chmod(0o600)
 print(json.dumps({'database':database,'migrations':len(HASHES[which]),'applied':True,'receipt':str(receipt)}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--database',choices=['erp','source'],required=True);p.add_argument('--apply',action='store_true');p.add_argument('--receipt',type=Path);a=p.parse_args()
 if a.apply:
  require(a.receipt is not None,'Private receipt path required');apply(a.database,a.receipt)
 else:
  env,db,user=connection(a.database);_,_,active,pending=inspect(a.database,env);print(json.dumps({'database':db,'user':user,'pending':sorted(pending),'applied':len(active),'cloudMutationExecuted':False}))
