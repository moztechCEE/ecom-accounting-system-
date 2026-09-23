"""Authenticated DEV acceptance; retains clearly labeled QA fixtures for review.
Never resets accounts or touches production API/database data.
"""
import json,subprocess,urllib.request,urllib.error,uuid
from pathlib import Path
BASE='https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1'
OUT=Path('/tmp/corely-sn-v2-acceptance');OUT.mkdir(exist_ok=True)
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
s,login=request('/auth/login','POST',{'email':setting('SUPER_ADMIN_EMAIL'),'password':setting('SUPER_ADMIN_PASSWORD')});assert s==200 and 'access_token' in login
bearer=login['access_token'];company='?entityId=tw-entity-001';tag=uuid.uuid4().hex[:4].upper();checks=[]
def call(path,method='GET',data=None,expected=200,binary=False):
 s,b=request(path,method,data,bearer,binary);assert s==expected,(path,s,b if not binary else 'binary error');return b
def check(value,label):
 assert value,label
 checks.append(label);print('PASS',label,flush=True)
product={'sku':'DEV-SNV2-'+tag,'name':'DEV SN v2 驗收 '+tag,'barcode':'04711299273087','type':'SIMPLE','modelNumber':'V'+tag,'hasSerialNumbers':True,'packageLength':10,'packageWidth':8,'packageHeight':3,'weight':0.125,'grossWeight':0.2,'netWeight':0.125,'hsCode':'8504','countryOfOrigin':'TW','attributes':{'keep':{'source':'feedback-v2'}}}
p=call('/products'+company,'POST',product,201);pid=p['id']
check(p['sku']==product['sku'],'full product creation')
conflict=call('/products'+company,'POST',product,409);check('已存在' in conflict['message'],'duplicate SKU clearly explains edit path')
p=call('/products/'+pid+company,'PATCH',{'barcode':'04711299273088','modelNumber':'V'+tag,'hasSerialNumbers':True,'attributes':{'snLabels':{'modelCode':'V'+tag,'styleCode':'','colorCode':'K','style':'','color':'黑'}}})
check(p['barcode']=='04711299273088' and p['attributes']['keep']['source']=='feedback-v2','product edit persists barcode and preserves unrelated attributes')
p=call('/products/'+pid+'/sn-profile'+company,'PATCH',{'barcode':'04711299273089','modelNumber':'V'+tag,'modelCode':'V'+tag,'styleCode':'','colorCode':'W','style':'','color':'白'})
p=call('/products/'+pid+company);check(p['barcode']=='04711299273089' and p['attributes']['snLabels']['color']=='白','reloading product reuses last saved SN profile and barcode')
data={'name':'DEV SN v2 驗收 '+tag,'productId':pid,'productName':p['name'],'sku':p['sku'],'barcode':p['barcode'],'model':p['modelNumber'],'style':'','color':'白','modelCode':'V'+tag,'styleCode':'','colorCode':'W','orderDate':'2026-09-23','manufactureDate':'2026-09-23','quantity':23,'capacity':20,'label':{'width':28,'height':7.5,'target':'box','showQr':True,'textX':8,'textY':0.7,'fontSize':1.45,'qrX':.25,'qrY':.25,'qrSize':6}}
def save(d):
 identifier=str(uuid.uuid4());call('/sn-labels/drafts/'+identifier+company,'PUT',{'revision':0,'data':d});return identifier
preview=call('/sn-labels/preview'+company,'POST',{'data':data},201)
again=call('/sn-labels/preview'+company,'POST',{'data':data},201)
check(preview['token']==again['token'] and preview['first']==1,'preview never reserves numbers')
id1=save(data);batch=call('/sn-labels/drafts/'+id1+'/activate'+company,'POST',{'revision':1,'previewToken':preview['token']},201)['batchId']
addition={**data,'quantity':2};upcoming=call('/sn-labels/preview'+company,'POST',{'data':addition},201)
check(upcoming['first']==24 and upcoming['last']==25 and upcoming['rows'][0]['id'].endswith('-003'),'upcoming preview shows correct continued SN and carton')
id2=save(addition);stale=call('/sn-labels/drafts/'+id2+'/activate'+company,'POST',{'revision':1,'previewToken':preview['token']},409)
allocation=call('/sn-labels/drafts/'+id2+'/activate'+company,'POST',{'revision':1,'previewToken':upcoming['token']},201)
check(allocation['first']==24 and allocation['batchId']==batch,'stale preview rejection consumes nothing; fresh preview allocates correctly')
active=call('/sn-labels/batches/'+batch+company);check([b['quantity'] for b in active['boxes']]==[20,3,2],'existing tail carton unchanged')
removable=save({**data,'name':'DEV v2 temporary deletion '+tag});call('/sn-labels/drafts/'+removable+company,'DELETE',{'revision':1});listing=call('/sn-labels'+company+'&search='+tag)
check(all(e['id']!=removable for e in listing['rows']),'draft deletion removes only target draft')
call('/sn-labels/drafts/'+id1+company,'DELETE',{'revision':1},409)
filtered=call('/sn-labels'+company+'&search='+tag+'&manufactureStart=2026-09-23&manufactureEnd=2026-09-23&status=active')
none=call('/sn-labels'+company+'&search='+tag+'&manufactureStart=2027-01-01&manufactureEnd=2027-01-01&status=active')
check(filtered['total']==1 and none['total']==0,'manufacturing date filter returns correct batches')
nsip=call('/products'+company,'POST',{**product,'sku':'DEV-NSI-'+tag,'name':'DEV NSI v2 驗收 '+tag,'modelNumber':'N'+tag,'attributes':{'snLabels':{'modelCode':'NSI'}}},201)
check(nsip['hasSerialNumbers'] is False,'NSI product disables individual SN tracking')
nsi={**data,'name':'DEV NSI v2 驗收 '+tag,'productId':nsip['id'],'productName':nsip['name'],'sku':nsip['sku'],'barcode':nsip['barcode'],'model':nsip['modelNumber'],'modelCode':'NSI','styleCode':'','colorCode':''}
np=call('/sn-labels/preview'+company,'POST',{'data':nsi},201);nid=save(nsi);nb=call('/sn-labels/drafts/'+nid+'/activate'+company,'POST',{'revision':1,'previewToken':np['token']},201)['batchId'];nd=call('/sn-labels/batches/'+nb+company)
check(nd['first'] is None and nd['cartons']==2 and not nd['boxes'][0]['serials'],'NSI creates only boxes, no serials')
pdf=call('/sn-labels/batches/'+nb+'/export'+company,'POST',{'kind':'cartons-no-sn','from':2,'to':2,'reason':'missed'},201,True);(OUT/'nsi-carton.pdf').write_bytes(pdf)
call('/sn-labels/batches/'+nb+'/export'+company,'POST',{'kind':'warranty','from':1,'to':2,'reason':'initial'},400)
check(pdf.startswith(b'%PDF'),'NSI tail carton PDF and forbidden warranty export')
reviewDraft=save({**data,'name':'DEV SN v2 預覽驗收 '+tag,'quantity':2})
receipt={'tag':tag,'productId':pid,'batchId':batch,'nsiBatchId':nb,'draftId':reviewDraft,'checks':checks,'retainedForReview':True}
(OUT/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2));print(json.dumps(receipt,ensure_ascii=False,indent=2))
