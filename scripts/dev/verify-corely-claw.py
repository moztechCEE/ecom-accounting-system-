#!/usr/bin/env python3
"""Authenticated DEV Claw acceptance. Only isolated QA logins, GETs and optional AI reads.

Reuses the strict DEV host/fixture/redirect guards from the expense acceptance harness.
Never modifies application records. --with-ai sends synthetic questions to configured DEV AI.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('qa', Path(__file__).with_name('verify-access-expense-ai.py'))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


def run(args):
    manifest = qa.load_manifest(args.manifest)
    test = qa.Acceptance(manifest, qa.validate_base(args.api), 'read-only', args.out, args.with_ai)
    test.receipt['scope'] = 'Corely Claw knowledge and read-only AI; no business writes'
    test.receipt['modelId'] = args.model_id or 'server-default'
    try:
        test.call('/health/ready')
        test.call('/ai/knowledge', expected=(401,))
        test.check(True, 'DEV ready; anonymous knowledge rejected')
        libraries = {}
        for actor in ['employee', 'admin']:
            user = manifest['users'][actor]
            login = test.call('/auth/login', method='POST', body={'email': user['email'], 'password': user['password']})
            test.check(login.get('user', {}).get('id') == user['id'] and bool(login.get('access_token')), actor + ' normal authenticated login')
            test.tokens[actor] = login['access_token']
            library = test.call('/ai/knowledge?locale=zh-TW', actor)
            entries = library.get('entries', [])
            test.check(bool(entries) and bool(library.get('version')) and bool(library.get('checkedAt')), actor + ' versioned guide library')
            test.check(all(e.get('sections') and e.get('sourceVersion') and e.get('sources') for e in entries), actor + ' full articles with source provenance')
            source_version = json.loads((ROOT / 'backend/src/modules/ai/knowledge/source-manifest.json').read_text())['sourceVersion']
            test.check(all(e['sourceVersion'] == source_version for e in entries), actor + ' deployed catalog matches accepted source version')
            for entry in entries:
                for source in entry['sources']:
                    path = ROOT / source['path']
                    qa.ensure(path.is_file() and path.resolve().is_relative_to(ROOT), 'Unknown source path')
                    import hashlib
                    qa.ensure(hashlib.sha256(path.read_bytes()).hexdigest() == source['sha256'], 'Source drift: ' + source['path'])
                for example in entry.get('examples', []):
                    qa.ensure(example.get('filename') and example.get('content') and example.get('contentType'), 'Incomplete example download')
            test.check(True, actor + ' source hashes match reviewed checkout and examples complete')
            libraries[actor] = library
        staff = libraries['employee']['entries']
        admin = libraries['admin']['entries']
        test.check(not any(e.get('path', '').startswith('/admin/') for e in staff), 'employee receives no restricted admin articles')
        test.check(any(e.get('path', '').startswith('/admin/') for e in admin) and len(admin) > len(staff), 'admin library reflects greater authorized scope')
        test.check(any(e.get('path') == '/ap/expenses' for e in staff), 'employee can read own expense guide')
        for locale in ['zh-TW', 'en']:
            result = test.call('/ai/knowledge?' + urllib.parse.urlencode({'query':'expense' if locale == 'en' else '費用申請','locale':locale,'currentPath':'/ap/expenses'}), 'employee')
            test.check(result.get('locale') == locale and any(e.get('path') == '/ap/expenses' for e in result.get('entries', [])), locale + ' search resolves expense article')
        forbidden = test.call('/ai/knowledge?' + urllib.parse.urlencode({'query':'權限','currentPath':'/admin/access-control'}), 'employee')
        test.check(not any(e.get('path', '').startswith('/admin/') for e in forbidden.get('entries', [])), 'untrusted page and search cannot bypass knowledge ACL')
        test.call('/ai/knowledge?locale=invalid', 'employee', expected=(400,))
        test.check(True, 'unsupported locale rejected')
        guide = test.call('/ai/guide?' + urllib.parse.urlencode({'query':'如何申請費用','currentPath':'/ap/expenses'}), 'employee')
        test.check(guide.get('status') == 'guide' and bool(guide.get('sources')), 'offline guide uses sourced library')
        test.receipt['knowledge'] = {actor:{'count':len(lib['entries']),'version':lib['version'],'ids':[e['id'] for e in lib['entries']]} for actor,lib in libraries.items()}
        if args.with_ai:
            available = test.call('/ai/status', 'employee')
            test.check(available.get('available') is True, 'real DEV AI provider enabled')
            for label, question in [
                ('grounded-guide','如何申請費用並交給直屬主管審核？請說明步驟與付款的差別。'),
                ('live-scope','請查詢我自己本月的費用申請總筆數與金額。'),
            ]:
                body = {'message':question,'entityId':manifest['entityId'],'currentPath':'/ap/expenses'}
                if args.model_id:
                    body['modelId'] = args.model_id
                answer = test.call('/ai/copilot/chat', 'employee', 'POST', body, expected=(200, 201))
                test.receipt.setdefault('aiAnswers',{})[label] = answer
                test.save()
                test.check(answer.get('status') == 'answered' and bool(answer.get('sources')) and bool(answer.get('checkedAt')), 'real AI ' + label + ' returns evidence')
                if label == 'grounded-guide':
                    test.check(all(s.get('kind') == 'knowledge' and s.get('sourceVersion') for s in answer['sources']), 'AI workflow answer cites versioned guide evidence')
                else:
                    test.check(answer.get('scope') == '自己的費用申請' and answer.get('data', {}).get('count') == 0 and answer.get('data', {}).get('total') == 0 and any(s.get('kind') == 'metric' for s in answer['sources']), 'AI live query returns isolated empty QA company and SELF scope')
        test.receipt['passed'] = True
        test.save()
    except Exception as exc:
        test.receipt['failure'] = str(exc)
        test.save()
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--api', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--with-ai', action='store_true')
    parser.add_argument('--model-id', choices=['gemini-3.5-flash-lite', 'gemini-3.5-flash'], help='Optional reviewed model; omission tests the server default')
    run(parser.parse_args())
