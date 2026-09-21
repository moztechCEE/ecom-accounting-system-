"""Authenticated DEV smoke check; prints counts/status only, never credentials.
Uses the existing administrator login secret; does not change any password.
"""
import json
import subprocess
import urllib.request
import urllib.error
import uuid

BASE = 'https://corely-erp-api-dev-sp5g377smq-de.a.run.app/api/v1'
def request(path, method='GET', data=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(BASE + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

for path, status in [('/health/ready', 200), ('/products', 401)]:
    actual, _ = request(path)
    assert actual == status, (path, actual)
    print(path, actual, flush=True)
assert request('/auth/register', 'POST', {})[0] == 403
print('Anonymous registration blocked', flush=True)

revision = json.loads(subprocess.check_output(['gcloud', 'run', 'revisions', 'describe', 'ecom-accounting-backend-00506-ray', '--region=asia-east1', '--project=moztech-main-db', '--format=json'], stderr=subprocess.DEVNULL))
settings = {v['name']: v for v in revision['spec']['containers'][0]['env']}
def setting(name):
    entry = settings[name]
    if 'value' in entry:
        return entry['value']
    ref = entry['valueFrom']['secretKeyRef']
    return subprocess.check_output(['gcloud', 'secrets', 'versions', 'access', ref['key'], '--secret=' + ref['name'], '--project=moztech-main-db'], stderr=subprocess.DEVNULL).decode().strip()

status, login = request('/auth/login', 'POST', {'email': setting('SUPER_ADMIN_EMAIL'), 'password': setting('SUPER_ADMIN_PASSWORD')})
assert status == 200 and 'access_token' in login, 'Existing admin secret did not authenticate; user login required, do not reset password'
token = login['access_token']
print('Existing-account password login verified', flush=True)
for path in ['/products?entityId=tw-entity-001', '/sales/orders?entityId=tw-entity-001&limit=5', '/reports/dashboard-sales-overview?entityId=tw-entity-001&startDate=2026-09-01&endDate=2026-09-21']:
    status, body = request(path, token=token)
    print(path, status, 'rows=' + str(len(body)) if isinstance(body, list) else 'response=' + str(type(body).__name__), flush=True)
    assert status == 200
    if isinstance(body, list):
        assert len(body) > 0

sku = 'DEV-SMOKE-' + uuid.uuid4().hex[:12]
status, product = request('/products?entityId=tw-entity-001', 'POST', {'sku': sku, 'name': 'DEV deployment validation', 'barcode': sku, 'type': 'SIMPLE'}, token)
assert status == 201 and product.get('sku') == sku, ('DEV product create failed', status, product.get('message'))
try:
    status, loaded = request('/products/' + product['id'] + '?entityId=tw-entity-001', token=token)
    assert status == 200 and loaded['sku'] == sku
    print('DEV product create/read verified', flush=True)
finally:
    status, _ = request('/products/' + product['id'] + '?entityId=tw-entity-001', 'DELETE', token=token)
    assert status == 200, 'DEV smoke fixture cleanup failed'
status, _ = request('/products/' + product['id'] + '?entityId=tw-entity-001', token=token)
assert status == 404
print('DEV test product removed; existing product data retained', flush=True)
