#!/usr/bin/env python3
"""Create a lead form on a client's Page. Verified working.

    python3 make_form.py form_spec.json

Creates it as DRAFT. Review with the client, then activate:
    python3 make_form.py form_spec.json --activate FORM_ID

Two things to know before you run this:

1. Lead forms need a PAGE access token, not the system user token. This script
   pulls the page token automatically from me/accounts.
2. Forms cannot be deleted, only archived. So create as DRAFT, confirm, then
   activate. A careless test form sits on the client's page forever.
"""
import json, os, sys, urllib.request, urllib.parse

V = 'v21.0'
KEYS = '/opt/data/bibi/api-keys.env'


def env():
    out = dict(os.environ)
    if os.path.exists(KEYS):
        for line in open(KEYS):
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                out[k.strip()] = v.strip()
    return out


TOK = env().get('META_ACCESS_TOKEN', '')


def page_token(page_id):
    """The system token cannot touch /leadgen_forms. Get the page token."""
    url = (f'https://graph.facebook.com/{V}/me/accounts?'
           + urllib.parse.urlencode({'fields': 'id,name,access_token',
                                     'limit': 200, 'access_token': TOK}))
    for p in json.load(urllib.request.urlopen(url, timeout=60)).get('data', []):
        if p['id'] == str(page_id):
            return p['access_token'], p.get('name')
    raise SystemExit(f'page {page_id} not found on this token')


def post(path, data, tok):
    d = dict(data)
    d['access_token'] = tok
    body = urllib.parse.urlencode(
        {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
         for k, v in d.items()}).encode()
    rq = urllib.request.Request(f'https://graph.facebook.com/{V}/{path}',
                                data=body, method='POST')
    try:
        return json.load(urllib.request.urlopen(rq, timeout=120))
    except urllib.error.HTTPError as e:
        return {'ERR': e.code, 'msg': e.read().decode()[:400]}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    ptok, pname = page_token(spec['page_id'])
    print(f"page: {pname}")

    if '--activate' in sys.argv:
        fid = sys.argv[sys.argv.index('--activate') + 1]
        r = post(fid, {'status': 'ACTIVE'}, ptok)
        print('activate:', r)
        return 0 if 'ERR' not in r else 1

    # strip the _comment / _note keys used for documentation in the template
    questions = [{k: v for k, v in q.items() if not k.startswith('_')}
                 for q in spec['questions']]

    payload = {
        'name': spec['name'],
        'locale': spec.get('locale', 'AR_AR'),
        'status': 'DRAFT',
        'questions': questions,
        'follow_up_action_url': spec['follow_up_url'],
    }
    # privacy policy is OFF by default; only send it when a url is supplied
    if spec.get('privacy_policy_url'):
        payload['privacy_policy'] = {
            'url': spec['privacy_policy_url'],
            'link_text': spec.get('privacy_link_text', 'Privacy Policy')}
    if spec.get('question_page_custom_headline'):
        payload['question_page_custom_headline'] = spec['question_page_custom_headline']
    if spec.get('contact_description'):
        payload['contact_information_description'] = spec['contact_description']
    if spec.get('context_card'):
        payload['context_card'] = spec['context_card']
    if spec.get('thank_you_page'):
        payload['thank_you_page'] = spec['thank_you_page']
    if spec.get('is_optimized_for_quality') is not None:
        payload['is_optimized_for_quality'] = spec['is_optimized_for_quality']
    # house defaults: do not hide the form, do let organic posts collect leads
    payload['block_display_for_non_targeted_viewer'] = \
        spec.get('block_display_for_non_targeted_viewer', False)
    payload['allow_organic_lead'] = spec.get('allow_organic_lead', True)
    if spec.get('tracking_parameters'):
        payload['tracking_parameters'] = spec['tracking_parameters']

    r = post(f"{spec['page_id']}/leadgen_forms", payload, ptok)
    if 'ERR' in r:
        print('FAIL', r)
        return 1
    print('created DRAFT form:', r['id'])
    print('\nReview it with the client, then activate:')
    print(f"  python3 make_form.py {sys.argv[1]} --activate {r['id']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
