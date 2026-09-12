#!/usr/bin/env python3
"""The evidence ledger. What we changed, and whether it worked.

    learn.py record  <json-file>     log a change you just made
    learn.py outcome <id> <metric>   fill in the result 7 days later
    learn.py ask     "<question>"    what has worked before, with numbers
    learn.py due                     changes old enough to be scored
    learn.py report                  what the ledger currently proves

The ledger is append only, one JSON object per line, at
/opt/data/bibi/workspace/mediabuyer/evidence.jsonl

Why this exists: a playbook written once is a snapshot of what someone believed
in September. A ledger is what actually happened. When the two disagree, the
ledger wins, and the playbook gets corrected.
"""
import json, os, sys, time, datetime as dt
from collections import defaultdict

LEDGER = '/opt/data/bibi/workspace/mediabuyer/evidence.jsonl'
SCORE_AFTER_DAYS = 7


def load():
    if not os.path.exists(LEDGER):
        return []
    out = []
    for line in open(LEDGER, encoding='utf-8'):
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return out


def append(rec):
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + '\n')


def rewrite(recs):
    with open(LEDGER, 'w', encoding='utf-8') as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')


def days_since(iso):
    d = dt.date.fromisoformat(iso[:10])
    return (dt.date.today() - d).days


def cmd_record(path):
    """Log a change. Required: client, lever, change, metric, before.

    lever is the category, so like changes can be compared across clients:
      offer | creative | copy | form_questions | form_greeting | form_quality
      radius | budget | cta | targeting | placement | landing
    """
    spec = json.load(open(path, encoding='utf-8'))
    for k in ('client', 'lever', 'change', 'metric', 'before'):
        if k not in spec:
            print(f'missing required field: {k}')
            return 1
    rec = {
        'id': f"{spec['client'][:12].lower().replace(' ', '-')}-{int(time.time())}",
        'date': dt.date.today().isoformat(),
        'client': spec['client'],
        'lever': spec['lever'],
        'change': spec['change'],
        'why': spec.get('why', ''),
        'metric': spec['metric'],
        'before': float(spec['before']),
        'after': None,
        'verdict': None,
        'campaign_id': spec.get('campaign_id'),
        'notes': spec.get('notes', ''),
    }
    append(rec)
    print(f"recorded {rec['id']}")
    print(f"  {rec['lever']}: {rec['change']}")
    print(f"  {rec['metric']} before = {rec['before']}")
    print(f"\nScore it in {SCORE_AFTER_DAYS} days:")
    print(f"  learn.py outcome {rec['id']} <new value>")
    return 0


def cmd_outcome(rid, value):
    """Fill in what happened. Lower is better for cost metrics."""
    recs = load()
    hit = None
    for r in recs:
        if r['id'] == rid:
            hit = r
    if not hit:
        print(f'no record {rid}')
        return 1
    after = float(value)
    hit['after'] = after
    hit['scored_on'] = dt.date.today().isoformat()
    lower_better = any(k in hit['metric'].lower()
                       for k in ('cpl', 'cost', 'cpc', 'cpm'))
    delta = after - hit['before']
    improved = delta < 0 if lower_better else delta > 0
    pct = (abs(delta) / hit['before'] * 100) if hit['before'] else 0
    # under 5% movement is noise, not a result
    hit['verdict'] = 'noise' if pct < 5 else ('worked' if improved else 'backfired')
    hit['change_pct'] = round(pct, 1)
    rewrite(recs)
    arrow = 'down' if delta < 0 else 'up'
    print(f"{rid}: {hit['metric']} {hit['before']} -> {after} "
          f"({arrow} {pct:.1f}%)  verdict: {hit['verdict'].upper()}")
    if hit['verdict'] == 'backfired':
        print('  Reverse it, and record the reversal as its own entry.')
    return 0


def cmd_ask(question):
    """What has worked before. Matches on lever keywords in the question."""
    q = question.lower()
    LEVERS = ['offer', 'creative', 'copy', 'form_questions', 'form_greeting',
              'form_quality', 'radius', 'budget', 'cta', 'targeting',
              'placement', 'landing']
    hints = {'question': 'form_questions', 'greeting': 'form_greeting',
             'quality': 'form_quality', 'volume': 'form_quality',
             'lead form': 'form_questions', 'headline': 'copy',
             'image': 'creative', 'video': 'creative', 'spend': 'budget',
             'city': 'radius', 'km': 'radius', 'distance': 'radius'}
    want = {l for l in LEVERS if l.replace('_', ' ') in q or l in q}
    for k, v in hints.items():
        if k in q:
            want.add(v)

    scored = [r for r in load() if r.get('verdict')]
    if not scored:
        print('Ledger is empty. Nothing has been scored yet, so there is no')
        print('evidence either way. Say that plainly rather than inventing one.')
        return 0

    rel = [r for r in scored if r['lever'] in want] if want else scored
    if not rel:
        print(f'Nothing recorded on that lever yet ({", ".join(sorted(want))}).')
        print('Answer from the playbook and record what you try.')
        return 0

    worked = [r for r in rel if r['verdict'] == 'worked']
    failed = [r for r in rel if r['verdict'] == 'backfired']
    print(f'{len(rel)} scored change(s) on this lever: '
          f'{len(worked)} worked, {len(failed)} backfired\n')
    for r in sorted(rel, key=lambda x: x['date'], reverse=True)[:8]:
        tag = {'worked': 'WORKED  ', 'backfired': 'BACKFIRED',
               'noise': 'no change'}[r['verdict']]
        print(f"  {tag}  {r['client']}  {r['date']}")
        print(f"     {r['change']}")
        print(f"     {r['metric']} {r['before']} -> {r['after']} "
              f"({r['change_pct']}%)")
        if r['why']:
            print(f"     why: {r['why']}")
        print()
    return 0


def cmd_due():
    """Changes old enough to score. Unscored changes teach nothing."""
    due = [r for r in load()
           if r.get('after') is None and days_since(r['date']) >= SCORE_AFTER_DAYS]
    if not due:
        print('Nothing due for scoring.')
        return 0
    print(f'{len(due)} change(s) due for scoring:\n')
    for r in due:
        print(f"  {r['id']}  {r['client']}  {days_since(r['date'])}d ago")
        print(f"     {r['change']}")
        print(f"     learn.py outcome {r['id']} <current {r['metric']}>")
        print()
    return 0


def cmd_report():
    """What the ledger currently proves, by lever."""
    scored = [r for r in load() if r.get('verdict')]
    if not scored:
        print('Nothing scored yet.')
        return 0
    by = defaultdict(lambda: {'worked': 0, 'backfired': 0, 'noise': 0,
                              'moves': []})
    for r in scored:
        by[r['lever']][r['verdict']] += 1
        if r['verdict'] == 'worked':
            by[r['lever']]['moves'].append(r['change_pct'])

    print(f'EVIDENCE LEDGER  {len(scored)} scored change(s)\n')
    rows = sorted(by.items(), key=lambda kv: -(kv[1]['worked']))
    for lever, s in rows:
        n = s['worked'] + s['backfired'] + s['noise']
        avg = sum(s['moves']) / len(s['moves']) if s['moves'] else 0
        print(f"  {lever:16} {s['worked']}/{n} worked", end='')
        if avg:
            print(f"   avg improvement {avg:.0f}%")
        else:
            print()
        if s['backfired']:
            print(f"  {'':16} {s['backfired']} backfired, read before reusing")

    strong = [l for l, s in by.items()
              if s['worked'] >= 3 and s['backfired'] == 0]
    if strong:
        print(f"\nProven on 3+ clients with no failures: {', '.join(strong)}")
        print('Promote these into the playbook as defaults.')
    weak = [l for l, s in by.items() if s['backfired'] > s['worked']]
    if weak:
        print(f"\nBackfires more than it works: {', '.join(weak)}")
        print('The playbook is wrong here. Correct it.')
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    c = sys.argv[1]
    try:
        if c == 'record':
            return cmd_record(sys.argv[2])
        if c == 'outcome':
            return cmd_outcome(sys.argv[2], sys.argv[3])
        if c == 'ask':
            return cmd_ask(' '.join(sys.argv[2:]))
        if c == 'due':
            return cmd_due()
        if c == 'report':
            return cmd_report()
    except IndexError:
        print(__doc__)
        return 2
    print(__doc__)
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
