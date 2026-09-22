"""Authenticated DEV acceptance; retains clearly labeled QA fixtures for review.
Never resets accounts or touches production API/database data.
"""
import json,subprocess,urllib.request,urllib.error,uuid
from pathlib import Path
BASE='https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1'
OUT=Path('/tmp/corely-sn-live-acceptance');OUT.mkdir(exist_ok=True)
def request(path,method='GET',data=None,token=None,binary=False):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=180) as r:
   body=r.read();return r.status,body if binary else json.loads(body)
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def cloud(*a):return subprocess.check_output(['gcloud',*a,'--project=moztech-main-db'],stderr=subprocess.DEVNULL).decode().strip()
revision=json.loads(cloud('run','revisions','describe','ecom-accounting-backend-00506-ray','--region=asia-east1','--format=json'))
env={x['name']:x for x in revision['spec']['containers'][0]['env']}
def setting(k):
 v=env[k]
 if 'value' in v:return v['value']
 ref=v['valueFrom']['secretKeyRef'];return cloud('secrets','versions','access',ref['key'],'--secret='+ref['name'])
assert request('/sn-labels')[0]==401
status,login=request('/auth/login','POST',{'email':setting('SUPER_ADMIN_EMAIL'),'password':setting('SUPER_ADMIN_PASSWORD')});assert status==200 and 'access_token' in login,'Existing admin login failed; do not change password'
token=login['access_token'];company='?entityId=tw-entity-001';tag=uuid.uuid4().hex[:4].upper();profile={'modelNumber':'QA'+tag,'style':'','color':'黑','modelCode':'Z'+tag,'styleCode':'','colorCode':'K'}
status,p=request('/products'+company,'POST',{'sku':'DEV-SN-'+tag,'name':'DEV SN 功能驗收 '+tag,'barcode':'04711299273087','type':'SIMPLE','modelNumber':profile['modelNumber'],'attributes':{'acceptanceFixture':True}},token);assert status==201,(status,p)
status,p=request('/products/'+p['id']+'/sn-profile'+company,'PATCH',profile,token);assert status==200,(status,p)
assert p['attributes']['acceptanceFixture'] is True and p['attributes']['snLabels']['styleCode']==''
data={'name':'DEV SN 功能驗收 '+tag,'productId':p['id'],'productName':p['name'],'sku':p['sku'],'barcode':p['barcode'],'model':p['modelNumber'],'style':'','color':'黑','modelCode':profile['modelCode'],'styleCode':'','colorCode':'K','orderDate':'2026-09-22','manufactureDate':'2026-09-01','quantity':43,'capacity':20,'label':{'width':28,'height':7.5,'target':'box','showQr':True,'textX':8,'textY':0.7,'fontSize':1.45,'qrX':.25,'qrY':.25,'qrSize':6}}
def activate(data):
 identifier=str(uuid.uuid4());s,b=request('/sn-labels/drafts/'+identifier+company,'PUT',{'revision':0,'data':data},token);assert s==200,(s,b)
 s,b=request('/sn-labels/drafts/'+identifier+'/activate'+company,'POST',{'revision':b['revision']},token);assert s==201,(s,b)
 return identifier,b
identifier,allocation=activate(data);batch=allocation['batchId']
s,replay=request('/sn-labels/drafts/'+identifier+'/activate'+company,'POST',{'revision':1},token);assert s==201 and replay['replayed'] and replay['batchId']==batch
s,b=request('/sn-labels/batches/'+batch+company,token=token);assert s==200 and [box['quantity'] for box in b['boxes']]==[20,20,3]
old_tail=b['boxes'][-1]
_,addition=activate({**data,'quantity':2});assert addition['batchId']==batch and addition['first']==44
s,after=request('/sn-labels/batches/'+batch+company,token=token);assert after['data']['quantity']==45 and after['boxes'][2]==old_tail
for kind in ['labels','cartons','cartons-no-sn','warranty','warehouse']:
 s,content=request('/sn-labels/batches/'+batch+'/export'+company,'POST',{'kind':kind,'from':41,'to':43,'reason':'missed'},token,binary=True);assert s==201,(s,content)
 ext='xlsx' if kind in ['warranty','warehouse'] else 'pdf';(OUT/(kind+'.'+ext)).write_bytes(content)
s,listing=request('/sn-labels'+company+'&search='+tag+'&status=active',token=token);assert s==200 and len(listing['rows'])==1 and listing['rows'][0]['data']['quantity']==45
s,after=request('/sn-labels/batches/'+batch+company,token=token);assert after['last']==45 and len([e for e in after['events'] if e['action']=='EXPORT'])==5
receipt={'productId':p['id'],'batchId':batch,'fixture':data['name'],'prefix':data['modelCode']+'K62','checks':['anonymous rejected','existing login','product profile preserves unrelated attributes','draft save','activation replay','43 SN with 20/20/3 cartons','same-day append to 45','tail carton unchanged','all five exports','reprint leaves last sequence 45','search','export audit'],'retainedForReview':True}
(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt,ensure_ascii=False,indent=2))
