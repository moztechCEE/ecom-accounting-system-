#!/usr/bin/env python3
"""DEV-only HTTP acceptance using the isolated access-expense fixture manifest.

Default mode is plan: no network. Operator must explicitly choose read-only or qa.
read-only performs login and authenticated GETs only. qa additionally creates and
updates only manifest QA users/roles and an expense tagged with the fixture prefix.
--with-ai sends a generated TEST PDF and QA expense aggregates to the real provider.
No production credentials, database connections, real receipts, or WMS sessions are used.

python3 /tmp/erp-access-expense-qa-20260923.py --manifest /tmp/corely-access-expense-ai-qa/manifest.json
python3 /tmp/erp-access-expense-qa-20260923.py --manifest ... --mode read-only --out /tmp/qa-read.json
python3 /tmp/erp-access-expense-qa-20260923.py --manifest ... --mode qa --with-ai --out /tmp/qa-write.json

PaymentTask uniqueness is deliberately NOT claimed by this HTTP harness. Supply
the output receipt to access-expense-db.py verify for a read-only database check.
Full successful WMS exchange remains covered by the existing WMS SSO acceptance.
"""
import argparse
import base64
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


DEV_HOST = 'corely-erp-api-dev-sp5g377smq-de.a.run.app'
ACTORS = ('employee', 'manager', 'cashier', 'admin')
PLAN = [
    'GET /health/ready; anonymous GET /users/me must be 401',
    'POST /auth/login for manifest QA users only; GET /users/me and /users/me/permissions',
    'GET /roles, /permissions and /users?q=<QA prefix> as QA admin; deny employee access',
    'GET /entities, /expense/reimbursement-items, /expense/requests, /banking/accounts?entityId=<QA UUID>',
    'GET /ai/status and /ai/guide; denied WMS access for expense-only QA employee',
    'qa: POST /roles with QA staff template; GET clone; PUT only QA employee roles; GET effective permissions; restore and DELETE clone',
    'qa: POST /expense/requests (already submits to supervisor; no separate submit route)',
    'qa: GET own/assigned detail and original evidence; deny cashier approval, employee self-approval and employee payment',
    'qa: PUT /expense/requests/<new QA ID>/approve as direct manager; duplicate approval rejected',
    'qa: PUT /expense/requests/<new QA ID>/payment-info as QA cashier with QA bank; duplicate payment rejected',
    'qa: GET history and paid detail; save receipt ID for separate database uniqueness verification',
    '--with-ai: synthetic TEST PDF -> POST /expense/receipts/recognize; own QA aggregate -> POST /ai/copilot/chat',
]


class CheckFailure(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CheckFailure('HTTP redirect refused; credentials were not forwarded')


def ensure(condition, label):
    if not condition:
        raise CheckFailure(label)


def uuid_value(value, label):
    try:
        parsed = uuid.UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise CheckFailure(label + ' must be a QA UUID') from None
    ensure(str(parsed) == value, label + ' must be a canonical UUID')
    return value


def validate_base(value):
    url = urllib.parse.urlsplit(value)
    host = url.hostname or ''
    tagged = re.fullmatch(r'[a-z][a-z0-9-]*---' + re.escape(DEV_HOST), host)
    ensure(url.scheme == 'https' and (host == DEV_HOST or tagged)
           and not url.username and not url.password and url.port in (None, 443)
           and not url.query and not url.fragment and url.path.rstrip('/') == '/api/v1',
           'Only the exact ERP DEV API or its tagged revision URL is allowed')
    return value.rstrip('/')


def load_manifest(path):
    source = Path(path)
    ensure(source.is_file(), 'Fixture manifest is missing')
    ensure(source.stat().st_mode & 0o077 == 0, 'Private fixture manifest must have mode 0600')
    data = json.loads(source.read_text())
    ensure(data.get('version') == 1, 'Unsupported fixture manifest version')
    ensure(re.fullmatch(r'erp_dev_[a-z0-9_]+', data.get('database', '')), 'Manifest must identify isolated DEV database')
    tag = data.get('tag', '')
    ensure(re.fullmatch(r'[A-F0-9]{8}', tag), 'Invalid QA fixture tag')
    ensure(data.get('phase') == 'active', 'Fixture manifest must be active')
    ensure(data.get('prefix') == 'DEV-EXPENSE-AI-' + tag, 'Unexpected QA prefix')
    for key in ('entityId', 'departmentId', 'accountId', 'itemId', 'bankAccountId'):
        uuid_value(data.get(key), key)
    for key in ('staff', 'cashier'):
        uuid_value(data.get('roleIds', {}).get(key), 'roleIds.' + key)
    for name in ACTORS:
        user = data.get('users', {}).get(name, {})
        uuid_value(user.get('id'), 'users.' + name + '.id')
        ensure(user.get('email') == 'qa-expense-ai-' + name + '-' + tag.lower() + '@employees.example', 'Only the exact fixture QA account may authenticate')
        ensure(user.get('name') == data['prefix'] + ' ' + name, 'User display name must match the fixture prefix and actor')
        ensure(isinstance(user.get('password'), str) and len(user['password']) >= 8, 'QA password is missing')
    ensure(len({data['users'][name]['id'] for name in ACTORS}) == len(ACTORS), 'QA actor IDs must be distinct')
    return data


def synthetic_pdf(prefix, today):
    lines = ['TEST ONLY - NOT A REAL RECEIPT', 'Supplier: QA Synthetic Office Supplies',
             'Invoice: TEST-QA-1200', 'Date: ' + today, 'Currency: TWD',
             'Office stationery supplies', 'Total: TWD 1200.00', 'One transaction only', prefix]
    escape = lambda s: s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    stream = ('BT /F1 16 Tf 50 780 Td ' + ' Tj 0 -30 Td '.join('(' + escape(line) + ')' for line in lines) + ' Tj ET').encode('ascii')
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    result = b'%PDF-1.4\n'; offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(result)); result += f'{index} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(result)
    result += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return result + f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()


class Acceptance:
    def __init__(self, manifest, base, mode, out, with_ai, resume=None):
        self.m, self.base, self.mode, self.out, self.with_ai = manifest, base, mode, Path(out), with_ai
        self.resume = resume
        self.tokens = {}
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.receipt = {'tag': manifest['tag'], 'entityId': manifest['entityId'], 'apiBase': base,
                        'mode': mode, 'withAi': with_ai, 'syntheticOnly': True,
                        'startedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'checks': [],
                        'createdRoleIds': [], 'expenseRequestId': None, 'passed': False,
                        'dbVerification': 'not_run', 'fullSsoExchange': 'not_run_use_existing_SSO_acceptance'}
        if resume:
            self.receipt['resumedFrom'] = resume['sourcePath']
            self.receipt['priorFailure'] = resume['failure']
            self.receipt['priorCheckCount'] = len(resume['checks'])
            self.receipt['expenseRequestId'] = resume['expenseRequestId']
            self.receipt['createdRoleIds'] = resume.get('createdRoleIds', [])
            self.receipt['removedRoleIds'] = resume.get('removedRoleIds', [])
            self.receipt['dbVerification'] = 'required'

    def save(self):
        self.out.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as file:
            json.dump(self.receipt, file, ensure_ascii=False, indent=2)
        os.chmod(self.out, 0o600)

    def check(self, value, label):
        ensure(value, label)
        self.receipt['checks'].append(label)
        print('PASS ' + label, flush=True)
        self.save()

    def call(self, path, actor=None, method='GET', body=None, expected=(200,)):
        ensure(path.startswith('/') and not path.startswith('//') and '\\' not in path, 'Unsafe API path')
        ensure(self.mode == 'qa' or method == 'GET' or path == '/auth/login'
               or (self.with_ai and path in ('/expense/receipts/recognize', '/ai/copilot/chat')), 'Mutation forbidden in read-only mode')
        headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
        if actor:
            headers['Authorization'] = 'Bearer ' + self.tokens[actor]
        req = urllib.request.Request(self.base + path, method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with self.opener.open(req, timeout=120) as response:
                status, raw = response.status, response.read(20 * 1024 * 1024)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(4096)
        except (urllib.error.URLError, TimeoutError):
            raise CheckFailure(method + ' ' + path.split('?')[0] + ' transport failed; no automatic retry') from None
        ensure(status in expected, f'{method} {path.split("?")[0]} returned {status}, expected {expected}')
        try:
            return json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            raise CheckFailure('Non-JSON API response') from None

    def own_request(self, result, status=None):
        ensure(isinstance(result, dict) and result.get('entityId') == self.m['entityId']
               and result.get('createdBy') == self.m['users']['employee']['id']
               and result.get('description', '').startswith(self.m['prefix']), 'Unexpected non-QA expense returned')
        uuid_value(result.get('id'), 'expense ID')
        if status:
            ensure(result.get('status') == status, 'Unexpected QA expense status')
        return result

    def readonly(self):
        self.call('/health/ready')
        self.call('/users/me', expected=(401,))
        self.check(True, 'health ready and anonymous access denied')
        for actor in ACTORS:
            fixture = self.m['users'][actor]
            login = self.call('/auth/login', method='POST', body={'email': fixture['email'], 'password': fixture['password']})
            ensure(login.get('user', {}).get('id') == fixture['id'] and login.get('access_token'), 'QA login identity mismatch')
            self.tokens[actor] = login['access_token']
            me = self.call('/users/me', actor)
            permissions = self.call('/users/me/permissions', actor)
            effective = {f"{p['resource']}:{p['action']}" for p in permissions}
            joined = {f"{p['permission']['resource']}:{p['permission']['action']}" for link in me['roles'] for p in link['role']['permissions']}
            self.check(me['id'] == fixture['id'] and effective == joined, actor + ' identity and effective permission union')
        roles = self.call('/roles', 'admin')
        staff = next((r for r in roles if r['id'] == self.m['roleIds']['staff']), None)
        self.check(staff is not None and 'assignedUserCount' in staff and 'deletionReason' in staff, 'role template and actor-aware deletion metadata')
        self.staff_role = staff
        self.call('/permissions', 'admin')
        users = self.call('/users?q=' + urllib.parse.quote(self.m['prefix']) + '&limit=100', 'admin')
        expected_ids = {self.m['users'][a]['id'] for a in ACTORS}
        self.check({u['id'] for u in users['items']} == expected_ids, 'access-control user list matches only isolated QA actors')
        self.call('/roles', 'employee', expected=(403,))
        self.call('/permissions', 'employee', expected=(403,))
        self.check(True, 'employee cannot read permission administration')
        entities = self.call('/entities?isActive=true', 'employee')
        self.check({entity['id'] for entity in entities} == {self.m['entityId']}, 'employee company selector is QA-only')
        query = '?entityId=' + self.m['entityId']
        items = self.call('/expense/reimbursement-items' + query, 'employee')
        item = next((item for item in items if item['id'] == self.m['itemId']), None)
        self.check(item is not None and self.m['prefix'] in item['name'], 'eligible QA reimbursement item')
        own = self.call('/expense/requests' + query + '&mine=true', 'employee')
        for request in own:
            self.own_request(request)
        if self.mode == 'qa' and self.resume:
            ensure({request['id'] for request in own} == {self.resume['expenseRequestId']}, 'Resume must refer to the only existing QA expense')
        elif self.mode == 'qa':
            ensure(not own, 'QA fixture already has requests; inspect prior receipt and clean up before another mutation run')
        banks = self.call('/banking/accounts' + query, 'cashier')
        self.check({bank['id'] for bank in banks} == {self.m['bankAccountId']} and banks[0]['currency'] == 'TWD', 'cashier sees only the QA TWD bank')
        self.call('/expense/requests?entityId=' + str(uuid.uuid4()), 'employee', expected=(403,))
        self.check(True, 'unknown company refused before expense data access')
        self.ai_status = self.call('/ai/status', 'employee')
        guide = self.call('/ai/guide?query=' + urllib.parse.quote('如何申請費用'), 'employee')
        self.check(guide.get('status') == 'guide' and guide.get('checkedAt'), 'static Copilot guide reports source status')
        self.call('/wms/portal/access', 'employee', expected=(403,))
        self.check(True, 'expense-only QA account cannot enter the existing WMS company')

    def qa(self):
        if self.resume:
            self.resume_approved_qa()
            return
        # New role is isolated; restore the QA user and remove only this cloned role.
        letters = ''.join(chr(65 + int(char, 16)) for char in uuid.uuid4().hex[:16])
        clone = self.call('/roles', 'admin', 'POST', {'code': 'QA_ACCESS_' + letters,
                          'name': self.m['prefix'] + ' temporary access template', 'templateRoleId': self.m['roleIds']['staff']}, (201,))
        clone_id = uuid_value(clone.get('id'), 'new QA role ID')
        self.receipt['createdRoleIds'].append(clone_id); self.save()
        self.check({link['permissionId'] for link in clone['permissions']} == {link['permissionId'] for link in self.staff_role['permissions']}, 'template copies exact permissions')
        user_path = '/users/' + self.m['users']['employee']['id'] + '/roles'
        self.call(user_path, 'admin', 'PUT', {'roleIds': [self.m['roleIds']['staff'], clone_id]})
        me = self.call('/users/me', 'employee')
        self.check({link['role']['id'] for link in me['roles']} == {self.m['roleIds']['staff'], clone_id}, 'only QA employee receives combined roles')
        self.call('/roles/' + clone_id, 'admin', 'DELETE', expected=(400,))
        self.call('/roles/' + clone_id, 'admin', 'PATCH', {'code': 'ADMIN'}, (400,))
        self.check(True, 'used role deletion and privileged code mutation denied')
        self.call(user_path, 'admin', 'PUT', {'roleIds': [self.m['roleIds']['staff']]})
        self.call('/roles/' + clone_id, 'admin', 'DELETE')
        self.receipt['removedRoleIds'] = [clone_id]; self.save()
        self.check(True, 'QA role assignment restored and unused clone removed')

        today = dt.datetime.now(dt.timezone.utc).date().isoformat()
        file = {'name': 'TEST-ONLY-' + self.m['tag'] + '.pdf', 'mimeType': 'application/pdf',
                'url': 'data:application/pdf;base64,' + base64.b64encode(synthetic_pdf(self.m['prefix'], today)).decode()}
        if self.with_ai:
            ensure(self.ai_status.get('available') is True, 'Controlled DEV AI is not available')
            recognized = self.call('/expense/receipts/recognize', 'employee', 'POST',
                                   {'entityId': self.m['entityId'], 'files': [file]}, (201,))
            self.check(recognized.get('status') == 'needs_confirmation'
                       and recognized['fields']['amountOriginal'] == 1200
                       and recognized['fields']['currency'] == 'TWD'
                       and recognized['fields']['expenseDate'] == today,
                       'real AI recognized synthetic TEST receipt and requires confirmation')

        body = {'entityId': self.m['entityId'], 'reimbursementItemId': self.m['itemId'], 'amountOriginal': 1200,
                'amountCurrency': 'TWD', 'amountFxRate': 1, 'description': self.m['prefix'] + ' TEST office stationery',
                'receiptType': 'RECEIPT', 'evidenceFiles': [file], 'metadata': {'qaTag': self.m['tag'], 'syntheticOnly': True}}
        created = self.call('/expense/requests', 'employee', 'POST', body, (201,))
        request = self.own_request(created.get('request', created), 'pending')
        request_id = request['id']; self.receipt['expenseRequestId'] = request_id
        self.receipt['dbVerification'] = 'required'; self.save()
        path = '/expense/requests/' + request_id
        request = self.own_request(self.call(path, 'manager'), 'pending')
        steps = request.get('approvalSteps', [])
        self.check(len(steps) == 1 and steps[0]['approverUserId'] == self.m['users']['manager']['id']
                   and request.get('canReview') is True and request.get('evidenceFiles', [{}])[0].get('url') == file['url'],
                   'direct manager sees assigned approval and original TEST evidence')
        decision = {'approvalStepId': uuid_value(steps[0]['id'], 'approval step ID'), 'remark': self.m['prefix'] + ' TEST approved'}
        self.call(path + '/approve', 'employee', 'PUT', decision, (403,))
        self.call(path + '/approve', 'cashier', 'PUT', decision, (403,))
        self.check(True, 'self-approval and unassigned cashier approval denied')
        approved = self.call(path + '/approve', 'manager', 'PUT', decision)
        self.own_request(approved, 'approved')
        self.call(path + '/approve', 'manager', 'PUT', decision, (403, 409))
        self.check(True, 'manager approval succeeds once; repeat approval refused')
        self.complete_payment(request_id)

    def resume_approved_qa(self):
        request_id = self.resume['expenseRequestId']
        path = '/expense/requests/' + request_id
        request = self.own_request(self.call(path, 'employee'), 'approved')
        steps = request.get('approvalSteps', [])
        ensure(len(steps) == 1 and steps[0].get('status') == 'approved'
               and steps[0].get('approverUserId') == self.m['users']['manager']['id'],
               'Resume requires the completed direct-manager QA approval')
        history = self.call(path + '/history', 'employee')
        ensure(not any(event.get('action') == 'payment_recorded' for event in history), 'Resume refuses previously recorded payment')
        self.own_request(self.call(path, 'cashier'), 'approved')
        self.check(True, 'resume existing approved QA request; cashier can access it and no payment has been recorded')
        self.complete_payment(request_id)

    def complete_payment(self, request_id):
        path = '/expense/requests/' + request_id
        payload = {'paymentStatus': 'paid', 'bankAccountId': self.m['bankAccountId'], 'amount': 1200,
                   'paymentDate': dt.datetime.now(dt.timezone.utc).isoformat()}
        self.call(path + '/payment-info', 'employee', 'PUT', payload, (403,))
        self.call(path + '/payment-info', 'cashier', 'PUT', {**payload, 'amount': 1199}, (400,))
        self.check(True, 'payment permission and full-amount validation enforced')
        paid = self.call(path + '/payment-info', 'cashier', 'PUT', payload)
        self.own_request(paid, 'paid')
        self.call(path + '/payment-info', 'cashier', 'PUT', payload, (409,))
        history = self.call(path + '/history', 'employee')
        self.check(sum(event['action'] == 'payment_recorded' for event in history) == 1,
                   'cashier records QA payment once with one payment history event')
        final = self.own_request(self.call(path, 'employee'), 'paid')
        self.check(final.get('paymentStatus') == 'paid', 'employee sees persisted payment status')
        nonce = uuid.uuid4().hex + uuid.uuid4().hex
        self.call('/wms/portal/ticket', 'employee', 'POST', {'role': 'dispatcher', 'nonce': nonce}, (403,))
        self.check(True, 'expense-only QA account cannot obtain dispatcher SSO ticket')
        if self.with_ai:
            answer = self.call('/ai/copilot/chat', 'employee', 'POST',
                               {'entityId': self.m['entityId'], 'message': '請查本月我的費用申請總額，包含已付款。',
                                'currentPath': '/ap/expenses'}, (201,))
            self.check(answer.get('status') == 'answered' and answer.get('scope') == '自己的費用申請'
                       and answer.get('data', {}).get('count') == 1
                       and float(answer.get('data', {}).get('total', -1)) == 1200,
                       'real Copilot retrieves only the QA employee expense aggregate')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--manifest')
    parser.add_argument('--api-base', help='Optional exact DEV candidate URL override')
    parser.add_argument('--mode', choices=('plan', 'read-only', 'qa'), default='plan')
    parser.add_argument('--resume-approved-receipt', help='Resume only payment/Copilot on the exact already-approved QA request in a failed receipt; never submit a new request')
    parser.add_argument('--with-ai', action='store_true', help='Explicitly send synthetic receipt/QA aggregate to configured AI; qa mode only')
    parser.add_argument('--out', default='/tmp/corely-access-expense-ai-qa/http-receipt.json')
    args = parser.parse_args()
    if args.mode == 'plan':
        print(json.dumps({'networkCalls': 0, 'plan': PLAN}, ensure_ascii=False, indent=2)); return
    ensure(args.manifest, '--manifest is required outside plan mode')
    ensure(not args.with_ai or args.mode == 'qa', '--with-ai requires qa mode')
    manifest = load_manifest(args.manifest)
    base = validate_base(args.api_base or manifest.get('apiBase', ''))
    ensure(Path(args.out).resolve() != Path(args.manifest).resolve(), 'Receipt must not overwrite private manifest')
    if args.mode == 'qa':
        ensure(not Path(args.out).exists(), 'QA receipt already exists; use a fresh output and inspect prior fixture state')
    resume = None
    if args.resume_approved_receipt:
        ensure(args.mode == 'qa', 'Resume requires qa mode')
        prior_path = Path(args.resume_approved_receipt)
        ensure(prior_path.resolve() != Path(args.out).resolve(), 'Resume must preserve the original failure receipt')
        ensure(prior_path.is_file() and prior_path.stat().st_mode & 0o077 == 0, 'Prior receipt must exist and be private')
        resume = json.loads(prior_path.read_text())
        ensure(resume.get('tag') == manifest['tag'] and resume.get('entityId') == manifest['entityId']
               and resume.get('mode') == 'qa' and resume.get('syntheticOnly') is True
               and resume.get('passed') is False and isinstance(resume.get('failure'), str),
               'Resume receipt must be a failed isolated QA run for the same fixture')
        uuid_value(resume.get('expenseRequestId'), 'resume expense ID')
        ensure('manager approval succeeds once; repeat approval refused' in resume.get('checks', [])
               and (not args.with_ai or 'real AI recognized synthetic TEST receipt and requires confirmation' in resume['checks']),
               'Prior receipt must prove direct-manager approval and requested AI receipt recognition')
        ensure(set(resume.get('createdRoleIds', [])) == set(resume.get('removedRoleIds', [])), 'Prior QA role clone must already be removed')
        resume['sourcePath'] = str(prior_path)
    run = Acceptance(manifest, base, args.mode, args.out, args.with_ai, resume)

    try:
        run.save(); run.readonly()
        if args.mode == 'qa':
            run.qa()
        run.receipt['passed'] = True
    except CheckFailure as error:
        run.receipt['failure'] = str(error)
        raise
    except Exception as error:
        # Do not serialize response bodies or exception values that may contain credentials.
        run.receipt['failure'] = type(error).__name__
        raise CheckFailure('Acceptance failed: ' + type(error).__name__) from None
    finally:
        run.receipt['finishedAt'] = dt.datetime.now(dt.timezone.utc).isoformat(); run.save()
    print(json.dumps({'passed': True, 'checks': len(run.receipt['checks']), 'receipt': str(run.out),
                      'paymentTaskUniqueness': run.receipt['dbVerification']}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except CheckFailure as error:
        print('FAIL ' + str(error), file=sys.stderr)
        sys.exit(1)
