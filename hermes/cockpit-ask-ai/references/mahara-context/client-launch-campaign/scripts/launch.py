#!/usr/bin/env python3
"""Build a client launch campaign: 1 CBO campaign, 1 ad set, 5 ads,
each ad carrying 3 primary texts + 3 headlines via asset_feed_spec.

    python3 launch.py brief.json

Everything is created PAUSED. Resumable: state is written next to the brief,
so a failed run can be fixed and re-run without creating duplicates.
"""
import json, os, sys, urllib.request, urllib.parse, uuid

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


def req(path, data=None, method='POST'):
    if method == 'DELETE':
        rq = urllib.request.Request(
            f'https://graph.facebook.com/{V}/{path}?access_token={TOK}', method='DELETE')
    else:
        d = dict(data or {})
        d['access_token'] = TOK
        body = urllib.parse.urlencode(
            {k: (json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
             for k, v in d.items()}).encode()
        rq = urllib.request.Request(f'https://graph.facebook.com/{V}/{path}',
                                    data=body, method=method)
    try:
        return json.load(urllib.request.urlopen(rq, timeout=180))
    except urllib.error.HTTPError as e:
        return {'ERR': e.code, 'msg': e.read().decode()[:500]}


def get(path, params=None):
    p = dict(params or {})
    p['access_token'] = TOK
    url = f'https://graph.facebook.com/{V}/{path}?' + urllib.parse.urlencode(p)
    try:
        return json.load(urllib.request.urlopen(url, timeout=90))
    except urllib.error.HTTPError as e:
        return {'ERR': e.code, 'msg': e.read().decode()[:300]}


def resolve_city(name, country):
    """Never trust a remembered city key. Meta accepts a wrong one silently."""
    r = get('search', {'type': 'adgeolocation',
                       'location_types': json.dumps(['city']),
                       'q': name, 'country_code': country})
    for c in r.get('data', []):
        if c['name'].lower() == name.lower() and c['country_code'] == country:
            return c['key']
    if r.get('data'):
        c = r['data'][0]
        print(f"    WARNING: '{name}' resolved to '{c['name']}' - verify this")
        return c['key']
    raise SystemExit(f'could not resolve city: {name}')


def upload_image(acc, path):
    boundary = 'b' + uuid.uuid4().hex
    data = open(path, 'rb').read()
    body = b''
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n{TOK}\r\n'.encode()
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="filename"; '
             f'filename="{os.path.basename(path)}"\r\nContent-Type: image/png\r\n\r\n').encode()
    body += data + f'\r\n--{boundary}--\r\n'.encode()
    rq = urllib.request.Request(
        f'https://graph.facebook.com/{V}/{acc}/adimages', data=body, method='POST',
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    try:
        r = json.load(urllib.request.urlopen(rq, timeout=300))
        return list(r['images'].values())[0]['hash']
    except urllib.error.HTTPError as e:
        print('  IMAGE FAIL', e.read().decode()[:200])
        return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    brief_path = sys.argv[1]
    b = json.load(open(brief_path, encoding='utf-8'))
    state_path = os.path.join(os.path.dirname(os.path.abspath(brief_path)),
                              'launch_state.json')
    st = json.load(open(state_path)) if os.path.exists(state_path) else {}

    def save():
        json.dump(st, open(state_path, 'w'), ensure_ascii=False, indent=1)

    acc = b['ad_account_id']
    if not acc.startswith('act_'):
        acc = 'act_' + acc
    page = b['page_id']
    form = b['lead_form_id']
    budget = int(round(float(b['daily_budget_usd']) * 100))

    # geo: resolve every city key live
    print('resolving cities...')
    cities = []
    for c in b['geo']['cities']:
        key = resolve_city(c['name'], b['geo']['country'])
        cities.append({'country': b['geo']['country'], 'key': key,
                       'name': c['name'], 'radius': c.get('radius', b['geo'].get('radius_km', 40)),
                       'distance_unit': 'kilometer'})
        print(f"  {c['name']} -> {key} @ {cities[-1]['radius']}km")
    geo = {'cities': cities}
    if b['geo'].get('regions'):
        geo['regions'] = b['geo']['regions']
    if b['geo'].get('excluded_cities'):
        geo['excluded_geo_locations'] = {'cities': b['geo']['excluded_cities']}

    # 1. campaign
    if not st.get('campaign'):
        c = req(f'{acc}/campaigns', {
            'name': b['names']['campaign'],
            'objective': 'OUTCOME_LEADS',
            'status': 'PAUSED',
            'special_ad_categories': b.get('special_ad_categories', []),
            'daily_budget': budget,
            'bid_strategy': 'LOWEST_COST_WITHOUT_CAP',
        })
        if 'ERR' in c:
            print('CAMPAIGN FAIL', c); return 1
        st['campaign'] = c['id']
        print('campaign:', c['id'])
        save()

    # 2. one ad set, no own budget (CBO owns it)
    if not st.get('adset'):
        s = req(f'{acc}/adsets', {
            'name': b['names']['adset'],
            'campaign_id': st['campaign'],
            'status': 'PAUSED',
            'billing_event': 'IMPRESSIONS',
            'optimization_goal': 'LEAD_GENERATION',
            'destination_type': 'ON_AD',
            'promoted_object': {'page_id': page},
            'targeting': {
                'geo_locations': geo,
                'age_min': b.get('age_min', 25),
                'age_max': b.get('age_max', 65),
                'targeting_automation': {'advantage_audience': 1},
            },
        })
        if 'ERR' in s:
            print('ADSET FAIL', s); return 1
        st['adset'] = s['id']
        print('ad set:', s['id'])
        save()

    # 3. images
    st.setdefault('images', {})
    for ad in b['ads']:
        img = ad['image']
        if st['images'].get(img):
            continue
        p = img if os.path.isabs(img) else os.path.join(b['assets_dir'], img)
        h = upload_image(acc, p)
        if not h:
            return 1
        st['images'][img] = h
        print('image:', os.path.basename(img), h[:16])
        save()

    # 4. five ads, each with 3 bodies + 3 titles
    st.setdefault('ads', {})
    for ad in b['ads']:
        name = ad['name']
        if st['ads'].get(name):
            continue
        bodies = [{'text': v['primary']} for v in ad['variants']]
        titles = [{'text': v['headline']} for v in ad['variants']]
        feed = {
            'images': [{'hash': st['images'][ad['image']]}],
            'bodies': bodies,
            'titles': titles,
            'descriptions': [{'text': ad.get('description', '')}],
            'ad_formats': ['SINGLE_IMAGE'],
            # form goes HERE, never in link_urls.
            # per-ad cta wins, else the brief default, else Book Now.
            'call_to_actions': [{'type': ad.get('cta', b.get('cta', 'BOOK_TRAVEL')),
                                 'value': {'lead_gen_form_id': form}}],
            # link_urls still required for SINGLE_IMAGE, website_url only
            'link_urls': [{'website_url': f'https://fb.me/{form}'}],
        }
        cr = req(f'{acc}/adcreatives', {
            'name': name,
            'object_story_spec': {'page_id': page},
            'asset_feed_spec': feed,
            'url_tags': ('utm_source={{site_source_name}}'
                         '&utm_medium=paid_social'
                         '&utm_campaign={{campaign.name}}'
                         '&utm_content={{ad.name}}'
                         '&utm_term={{adset.name}}'
                         '&utm_placement={{placement}}'),
        })
        if 'ERR' in cr:
            print(f'CREATIVE {name} FAIL', cr); return 1
        a = req(f'{acc}/ads', {
            'name': name,
            'adset_id': st['adset'],
            'creative': {'creative_id': cr['id']},
            'status': 'PAUSED',
        })
        if 'ERR' in a:
            print(f'AD {name} FAIL', a); return 1
        st['ads'][name] = a['id']
        print(f'  ad {name}: {a["id"]}  ({len(bodies)} bodies, {len(titles)} titles)')
        save()

    print(f'\nDONE. campaign={st["campaign"]} adset=1 ads={len(st["ads"])} '
          f'${budget/100:.0f}/day')
    print('ALL PAUSED. Run verify.py, then review in Ads Manager before enabling.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
