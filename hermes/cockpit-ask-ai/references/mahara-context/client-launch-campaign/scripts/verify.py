#!/usr/bin/env python3
"""Verify a built launch campaign by re-reading what Meta actually stored.

    python3 verify.py brief.json

Never trust the create calls. Meta accepts a wrong city key without complaint,
and a silently wrong geo sends real budget to the wrong place.
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


def get(path, params=None):
    p = dict(params or {})
    p['access_token'] = TOK
    url = f'https://graph.facebook.com/{V}/{path}?' + urllib.parse.urlencode(p)
    try:
        return json.load(urllib.request.urlopen(url, timeout=90))
    except urllib.error.HTTPError as e:
        return {'ERR': e.code, 'msg': e.read().decode()[:250]}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    brief_path = sys.argv[1]
    b = json.load(open(brief_path, encoding='utf-8'))
    state_path = os.path.join(os.path.dirname(os.path.abspath(brief_path)),
                              'launch_state.json')
    st = json.load(open(state_path))
    problems = []

    c = get(st['campaign'], {'fields': 'name,status,daily_budget,bid_strategy,objective'})
    spend = int(c.get('daily_budget', 0)) / 100
    print('CAMPAIGN')
    print(f"  {c.get('name')}")
    print(f"  status={c.get('status')}  ${spend:.0f}/day  {c.get('objective')}")
    if c.get('status') != 'PAUSED':
        problems.append('campaign is not PAUSED')
    if abs(spend - float(b['daily_budget_usd'])) > 0.01:
        problems.append(f"budget is ${spend:.0f}, brief says ${b['daily_budget_usd']}")

    s = get(st['adset'], {'fields': 'name,status,daily_budget,optimization_goal,'
                                    'destination_type,promoted_object,targeting'})
    t = s.get('targeting', {})
    print('\nAD SET')
    print(f"  {s.get('name')}  status={s.get('status')}")
    print(f"  own_budget={s.get('daily_budget')} (should be None under CBO)")
    print(f"  opt={s.get('optimization_goal')}  dest={s.get('destination_type')}")
    print(f"  age={t.get('age_min')}-{t.get('age_max')}")
    print('  CITIES AS STORED, read these carefully:')
    for city in t.get('geo_locations', {}).get('cities', []):
        print(f"    {city.get('name')}  key={city.get('key')}  {city.get('radius')}km")
    want = {c['name'].lower() for c in b['geo']['cities']}
    got = {c.get('name', '').lower() for c in t.get('geo_locations', {}).get('cities', [])}
    if want != got:
        problems.append(f'geo mismatch: wanted {sorted(want)}, stored {sorted(got)}')
    if s.get('status') != 'PAUSED':
        problems.append('ad set is not PAUSED')
    if s.get('daily_budget'):
        problems.append('ad set has its own budget, breaks CBO')
    if t.get('flexible_spec') or t.get('interests'):
        problems.append('targeting is not broad, interests found')

    print(f"\nADS ({len(st['ads'])})")
    for name, aid in st['ads'].items():
        a = get(aid, {'fields': 'name,status,creative{asset_feed_spec}'})
        feed = (a.get('creative') or {}).get('asset_feed_spec') or {}
        nb, nt = len(feed.get('bodies', [])), len(feed.get('titles', []))
        cta = (feed.get('call_to_actions') or [{}])[0].get('type')
        fid = (feed.get('call_to_actions') or [{}])[0].get('value', {}).get('lead_gen_form_id')
        ok = nb == 3 and nt == 3 and str(fid) == str(b['lead_form_id'])
        print(f"  {name:38} {a.get('status'):7} bodies={nb} titles={nt} cta={cta}"
              f"{'' if ok else '   <-- CHECK'}")
        if a.get('status') != 'PAUSED':
            problems.append(f'{name} is not PAUSED')
        if nb != 3 or nt != 3:
            problems.append(f'{name} has {nb} bodies / {nt} titles, expected 3/3')
        if str(fid) != str(b['lead_form_id']):
            problems.append(f'{name} points at form {fid}, brief says {b["lead_form_id"]}')

    print('\n' + ('PROBLEMS:' if problems else 'No problems found.'))
    for p in problems:
        print('  -', p)
    return 1 if problems else 0


if __name__ == '__main__':
    raise SystemExit(main())
