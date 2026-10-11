#!/usr/bin/env python3
"""R4: import the per-card LTV baselines (and September's book points) from Convex, then preview LTV.

The CEO, 2026-09-19, asked for LTV = "Number two": each card's typed value frozen as a
baseline, plus only the payments logged from then on; "Let's just do it for clients in
onboarding and active clients." The baselines lived in Convex (ceoDaily, metric
money.ltv.card); the cockpit's ltv.preview reads the earliest point per card from
cockpit_metric_days, which has no money rows, so payments never add to LTV.

Source: a JSON file read from the paused Convex deployment adorable-seahorse-418
(`npx convex data ceoDaily --prod`): 26 money.ltv.card points (the earliest per card:
24 dated 2026-09-19, Convex has no 2026-09-18 point, and two cards first seen
2026-10-07) and the two September money.book.* points (dated 2026-09-01), so the
collection-rate history (A124) has September.

Dry run by default: it validates the source, checks every value against a second
source in Supabase (the Convex-era mirror cockpit_metric_values), compares with what
cockpit_metric_days already holds, prints the rows and a plan sha256, and previews LTV
(the same arithmetic as cockpit_ceo_action 'ltv.preview', read-only, with the planned
baselines counted as if imported, and the preview's own gates reported).

`--apply --plan <sha256>` inserts exactly that plan in one transaction:
ON CONFLICT (day, metric, scope) DO NOTHING, so a second run writes nothing, and one
cockpit_audit_log row (ltv.baseline.import) when anything was inserted. SQL runs through
`composio execute SUPABASE_BETA_RUN_SQL_QUERY` with stdin closed; no key is read or printed.

  python3 scripts/import-ltv-baselines.py --source r4-convex-source.json
  python3 scripts/import-ltv-baselines.py --source r4-convex-source.json --apply --plan <sha>
  python3 scripts/import-ltv-baselines.py --source r4-convex-source.json --print-apply-sql
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone

PROJECT = 'bldgtotkfmhoxmlzowdx'
DEPLOYMENT = 'adorable-seahorse-418'
CEO_EMAIL = 'aziz@maharamedia.com'
LTV_METRIC = 'money.ltv.card'
BOOK_METRICS = ('money.book.projected', 'money.book.collected')
EXPECTED_LTV = 26
EXPECTED_BOOK = 2
SCOPE = re.compile(r'^client:[0-9a-z]{6,20}$')
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')
CONVEX_ID = re.compile(r'^[0-9a-z]{32}$')
# cockpit_ceo_action 'ltv.preview': stages and names that are out of scope.
OUT_OF_SCOPE_STAGES = ('Paused', 'Stopped', 'CANCELLED ONBOARDING', 'SALES TEAM TO CONTACT')
# The mirror's day for each source day: the 19 Sep baselines were mirrored on 21 Sep
# (the mirror starts then); the 7 Oct points on 7 Oct; September's book on 30 Sep.
MIRROR_DAY = {'2026-09-19': '2026-09-21', '2026-10-07': '2026-10-07'}
BOOK_MIRROR = {'money.book.projected': 'money.projected_mrr', 'money.book.collected': 'money.collected_from_recurring'}


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def validate(source):
    """The source file, checked before anything is planned. Raises ValueError with the reason."""
    if source.get('deployment') != DEPLOYMENT:
        raise ValueError('The source is not the Convex production deployment ' + DEPLOYMENT)
    ltv, book = source.get('ltv'), source.get('book')
    if not isinstance(ltv, list) or not isinstance(book, list):
        raise ValueError('The source needs ltv and book lists')
    if len(ltv) != EXPECTED_LTV or len(book) != EXPECTED_BOOK:
        raise ValueError(f'Expected {EXPECTED_LTV} LTV points and {EXPECTED_BOOK} book points, got {len(ltv)} and {len(book)}')
    seen_scope, seen_id = set(), set()
    for r in ltv + book:
        if not CONVEX_ID.match(str(r.get('_id', ''))) or r['_id'] in seen_id:
            raise ValueError('Every point needs its own Convex id')
        seen_id.add(r['_id'])
        if not DAY.match(str(r.get('date', ''))) or not isinstance(r.get('at'), (int, float)):
            raise ValueError(f"Point {r['_id']} needs a day and a capture time")
        if not isinstance(r.get('value'), (int, float)) or isinstance(r.get('value'), bool) or r['value'] != r['value'] or r['value'] < 0 or r['value'] in (float('inf'),):
            raise ValueError(f"Point {r['_id']} has an invalid value")
    for r in ltv:
        if r.get('metric') != LTV_METRIC or not SCOPE.match(str(r.get('scope', ''))):
            raise ValueError(f"LTV point {r['_id']} is not a card's money.ltv.card")
        if r['scope'] in seen_scope:
            raise ValueError(f"Card {r['scope']} has two baselines; only the earliest is a baseline")
        seen_scope.add(r['scope'])
        if r['date'] not in MIRROR_DAY:
            raise ValueError(f"LTV point {r['_id']} is dated {r['date']}, outside the reviewed days")
    if sorted(r.get('metric') for r in book) != sorted(BOOK_METRICS) or any(r.get('scope') != 'company' or r.get('date') != '2026-09-01' for r in book):
        raise ValueError("The book points must be September's money.book.projected and money.book.collected for the company")
    return source


def plan_rows(source):
    rows = []
    for r in sorted(source['ltv'], key=lambda x: x['scope']) + sorted(source['book'], key=lambda x: x['metric']):
        rows.append({
            'day': r['date'], 'metric': r['metric'], 'scope': r['scope'], 'value': r['value'],
            'captured_at': iso(r['at']), 'source_deployment': DEPLOYMENT, 'source_id': r['_id'], 'source_record': r,
        })
    return rows


def plan_sha(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def q(s):
    return "'" + str(s).replace("'", "''") + "'"


def existing_sql(rows):
    keys = ','.join(f"({q(r['day'])}::date,{q(r['metric'])},{q(r['scope'])})" for r in rows)
    scopes = ','.join(q(r['scope']) for r in rows if r['metric'] == LTV_METRIC) or "''"
    return (
        "with k(day, metric, scope) as (values " + keys + ")\n"
        "select 'same_key' as what, to_char(d.day,'YYYY-MM-DD') as day, d.metric, d.scope, d.value::text as value, d.source_id\n"
        "from public.cockpit_metric_days d join k using (day, metric, scope)\n"
        "union all\n"
        "select 'earlier', to_char(d.day,'YYYY-MM-DD'), d.metric, d.scope, d.value::text, d.source_id\n"
        f"from public.cockpit_metric_days d where d.metric = {q(LTV_METRIC)} and d.scope in ({scopes})\n"
        "union all\n"
        "select 'any_money', null, d.metric, null, count(*)::text, null from public.cockpit_metric_days d where d.metric like 'money.%' group by d.metric"
    )


def mirror_sql(rows):
    scopes = ','.join(q(r['scope']) for r in rows if r['metric'] == LTV_METRIC) or "''"
    return (
        "select 'ltv' as what, to_char(day,'YYYY-MM-DD') as day, scope, value::text as value from public.cockpit_metric_values\n"
        f"where metric = 'clients.ltv' and \"window\" = 'snapshot' and scope in ({scopes}) and day in (date '2026-09-21', date '2026-10-07')\n"
        "union all\n"
        "select metric, to_char(day,'YYYY-MM-DD'), scope, value::text from public.cockpit_metric_values\n"
        "where metric in ('money.projected_mrr','money.collected_from_recurring') and scope = 'company' and day = date '2026-09-30'"
    )


def cross_check(rows, mirror):
    """Each planned value against the Supabase mirror of what Convex showed. Returns (matches, differences, unmatched)."""
    by = {(m['what'], m['day'], m['scope']): float(m['value']) for m in mirror}
    same, diff, none = [], [], []
    for r in rows:
        if r['metric'] == LTV_METRIC:
            key = ('ltv', MIRROR_DAY[r['day']], r['scope'])
        else:
            key = (BOOK_MIRROR[r['metric']], '2026-09-30', 'company')
        if key not in by:
            none.append(r)
        elif abs(by[key] - float(r['value'])) < 0.005:
            same.append(r)
        else:
            diff.append((r, by[key]))
    return same, diff, none


def preview_sql(rows):
    planned = ','.join(f"({q(r['scope'])},{q(r['day'])}::date,{float(r['value'])}::float8)" for r in rows if r['metric'] == LTV_METRIC) or "(null,null,null)"
    stages = ','.join(q(s) for s in OUT_OF_SCOPE_STAGES)
    return f"""with planned(scope, day, value) as (values {planned}),
stored as (select scope, day, value from public.cockpit_metric_days where metric = 'money.ltv.card'),
allb as (select * from stored union all select p.* from planned p where not exists (select 1 from stored s where s.scope = p.scope and s.day = p.day)),
cards as (select distinct on (clickup_task_id) * from public.cockpit_client_billing_days order by clickup_task_id, day desc),
base as (select distinct on (scope) scope, day, value from allb order by scope, day),
r as (select c.clickup_task_id, c.client_name, c.stage, c.ltv_usd, c.captured_at, b.day as base_day, b.value as baseline,
        (c.stage not in ({stages}) or c.stage is null) and c.client_name !~* 'playing account|\\[internal test\\]' as eligible
      from cards c left join base b on b.scope = 'client:' || c.clickup_task_id),
t as (select r.*, coalesce(p.logged, 0) as logged, coalesce(p.payment_count, 0) as payment_count from r left join lateral (
        select sum((x->>'usd')::numeric) as logged, count(*) as payment_count
        from public.cockpit_sections s cross join lateral jsonb_array_elements(s.payload#>'{{attribution,transactions}}') x
        where s.key = 'money' and x->>'direction' = 'in' and x->>'clientTaskId' = r.clickup_task_id and (x->>'day')::date >= r.base_day) p on true)
select clickup_task_id, client_name, stage, to_char(base_day,'YYYY-MM-DD') as base_day, round(baseline::numeric, 2)::text as baseline,
       round(logged, 2)::text as logged, payment_count, round(baseline::numeric + logged, 2)::text as target, ltv_usd::text as current,
       round(baseline::numeric + logged - ltv_usd, 2)::text as delta, eligible
from t order by client_name"""


GATES_SQL = """select (select history_ready and revision = totals_revision from public.cockpit_manual_payment_state where id) as reconciled,
       (select revision::text || '/' || totals_revision::text from public.cockpit_manual_payment_state where id) as revisions,
       (select ok and computed_at > now() - interval '24 hours' and jsonb_typeof(payload#>'{attribution,transactions}') = 'array' from public.cockpit_sections where key = 'money') as money_fresh,
       (select to_char(computed_at at time zone 'Asia/Kuwait', 'YYYY-MM-DD HH24:MI') from public.cockpit_sections where key = 'money') as money_at,
       exists(select 1 from public.cockpit_client_billing_days where captured_at > now() - interval '24 hours') as billing_fresh"""


def preview(rows_out):
    """The ltv.preview selection: rows to write, cards missing a baseline or a typed LTV, and the out-of-scope count."""
    def num(x):
        return None if x is None else float(x)
    write, missing, out = [], [], 0
    for r in rows_out:
        if not r['eligible']:
            out += 1
            continue
        if r['base_day'] is None or r['current'] is None:
            missing.append(r)
            continue
        if int(r['payment_count']) > 0 or abs(num(r['delta'])) >= 0.01:
            write.append(r)
    write.sort(key=lambda r: -abs(num(r['delta'])))
    return write, missing, out


def apply_sql(rows, sha, source_sha, cross):
    body = json.dumps(rows, sort_keys=True, separators=(',', ':'))
    if '$rows$' in body or '$meta$' in body:
        raise ValueError('The source contains a quoting marker; refusing to build SQL')
    meta = json.dumps({'script': 'scripts/import-ltv-baselines.py', 'source_deployment': DEPLOYMENT, 'source_sha256': source_sha,
                       'plan_sha256': sha, 'planned': len(rows), 'cross_check': cross, 'done_for': CEO_EMAIL}, sort_keys=True)
    return f"""begin;
with ins as (
  insert into public.cockpit_metric_days(day, metric, scope, value, captured_at, source_deployment, source_id, source_record)
  select (r->>'day')::date, r->>'metric', r->>'scope', (r->>'value')::float8, (r->>'captured_at')::timestamptz,
         r->>'source_deployment', r->>'source_id', r->'source_record'
  from jsonb_array_elements($rows${body}$rows$::jsonb) r
  on conflict (day, metric, scope) do nothing
  returning day, metric, scope
)
insert into public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, "before", "after", metadata)
select 'ltv.baseline.import', 'cockpit_metric_days', 'money.ltv.card', 'claude-for:{CEO_EMAIL}', 'scripts', 'composio-sql', null,
       jsonb_build_object('inserted', count(*), 'keys', jsonb_agg(jsonb_build_object('day', day, 'metric', metric, 'scope', scope))),
       $meta${meta}$meta$::jsonb
from ins having count(*) > 0;
commit;"""


def composio_sql(query):
    if not shutil.which('composio'):
        raise RuntimeError('composio is not installed on this machine')
    run = subprocess.run(['composio', 'execute', 'SUPABASE_BETA_RUN_SQL_QUERY', '-d', json.dumps({'ref': PROJECT, 'query': query})],
                         stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=180)
    out = json.loads(run.stdout or '{}')
    if out.get('storedInFile') and out.get('outputFilePath'):
        path = out['outputFilePath']
        with open(path) as f:
            out = json.load(f)
        os.remove(path)
    if not out.get('successful'):
        raise RuntimeError('SQL failed: ' + str(out.get('error') or out.get('data', {}).get('message') or 'unknown')[:400])
    return out.get('data', {}).get('result') or []


def money(x):
    return 'n/a' if x is None else f"${float(x):,.2f}"


def main(argv=None, sql=composio_sql, out=print):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--source', required=True)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--plan')
    ap.add_argument('--print-apply-sql', action='store_true')
    ap.add_argument('--no-preview', action='store_true')
    a = ap.parse_args(argv)
    with open(a.source, 'rb') as f:
        raw = f.read()
    source_sha = hashlib.sha256(raw).hexdigest()
    rows = plan_rows(validate(json.loads(raw)))
    sha = plan_sha(rows)

    mirror = sql(mirror_sql(rows))
    same, diff, none = cross_check(rows, mirror)
    cross = f'{len(same)} of {len(rows)} equal the Convex-era mirror cockpit_metric_values' + (f'; {len(diff)} differ' if diff else '') + (f'; {len(none)} have no mirror value' if none else '')
    if a.print_apply_sql:
        out(apply_sql(rows, sha, source_sha, cross))
        return 0

    existing = sql(existing_sql(rows))
    same_key = {(e['day'], e['metric'], e['scope']): e for e in existing if e['what'] == 'same_key'}
    earlier = [e for e in existing if e['what'] == 'earlier' and e['day'] < next(r['day'] for r in rows if r['scope'] == e['scope'])]
    any_money = {e['metric']: e['value'] for e in existing if e['what'] == 'any_money'}

    out(f"LTV baseline import, {'APPLY' if a.apply else 'dry run (nothing is written)'}")
    out(f"Source {os.path.basename(a.source)} sha256 {source_sha}: Convex {DEPLOYMENT}, {EXPECTED_LTV} money.ltv.card baselines + September's two book points")
    out(f"cockpit_metric_days money rows today: {', '.join(f'{k} {v}' for k, v in sorted(any_money.items())) or 'none'}")
    out(f"Second source: {cross}.")
    for r, m in diff:
        out(f"  DIFFERS {r['metric']} {r['scope']} {r['day']}: Convex {r['value']} vs mirror {m}")
    for r in none:
        out(f"  no mirror value: {r['metric']} {r['scope']} {r['day']}")
    out('Rows (day, metric, scope, value, Convex id):')
    fresh = []
    for r in rows:
        k = (r['day'], r['metric'], r['scope'])
        state = 'new'
        if k in same_key:
            state = 'already stored' if abs(float(same_key[k]['value']) - float(r['value'])) < 0.005 else f"stored with {same_key[k]['value']}: kept as stored"
        else:
            fresh.append(r)
        out(f"  {r['day']}  {r['metric']:<21} {r['scope']:<18} {r['value']:>10}  {r['source_id']}  {state}")
    if earlier:
        out(f"Note: {len(earlier)} card(s) already have an earlier money.ltv.card point, which stays the baseline: " + ', '.join(e['scope'] for e in earlier))
    out(f"A commit would insert {len(fresh)} of {len(rows)} rows and one audit row (ltv.baseline.import)." if fresh else 'Nothing new to insert.')
    out(f'Plan sha256: {sha}')

    if not a.no_preview:
        gates = (sql(GATES_SQL) or [{}])[0]
        write, missing, outside = preview(sql(preview_sql(rows)))
        out('\nLTV preview (read-only; the same arithmetic as ltv.preview, baselines counted as if imported):')
        out(f"  Gates today: totals reconciled {gates.get('reconciled')} (revision/totals {gates.get('revisions')}), Money fresh {gates.get('money_fresh')} (computed {gates.get('money_at')} Kuwait), billing fresh {gates.get('billing_fresh')}.")
        if not (gates.get('reconciled') and gates.get('money_fresh') and gates.get('billing_fresh')):
            out('  The cockpit\'s own preview refuses until all three are true: R1 and R2 in the native release make Money publish, and that publish sets totals_revision = revision.')
        out(f"  {len(write)} card(s) would change, {len(missing)} in scope miss a baseline or a typed LTV, {outside} out of scope (paused, stopped, cancelled, internal).")
        for r in write:
            out(f"    {r['client_name'][:38]:<38} baseline {money(r['baseline'])} on {r['base_day']} + {r['payment_count']} payment(s) {money(r['logged'])} = {money(r['target'])}; ClickUp now {money(r['current'])}; change {money(r['delta'])}")
        for r in missing:
            why = 'no baseline' if r['base_day'] is None else 'no LTV typed on the card'
            out(f"    missing: {r['client_name'][:38]} ({r['stage']}): {why}")
        out('  The payments counted are the stale Money section\'s Transactions until Money publishes again.' if not gates.get('money_fresh') else '')

    if not a.apply:
        if fresh:
            out(f"To write it: python3 scripts/import-ltv-baselines.py --source {a.source} --apply --plan {sha}")
        return 0
    if a.plan != sha:
        raise SystemExit('--apply needs --plan with the sha256 this dry run printed; the plan changed or was not given. Nothing was written.')
    if not fresh:
        out('Nothing to write.')
        return 0
    sql(apply_sql(rows, sha, source_sha, cross))
    back = sql("select count(*)::int as n, count(*) filter (where metric = 'money.ltv.card')::int as ltv from public.cockpit_metric_days where source_deployment = " + q(DEPLOYMENT)
               + " and source_id in (" + ','.join(q(r['source_id']) for r in rows) + ")")
    audit = sql("select count(*)::int as n from public.cockpit_audit_log where action = 'ltv.baseline.import' and metadata->>'plan_sha256' = " + q(sha))
    out(f"Written. Read back: {back[0]['n']} of {len(rows)} rows ({back[0]['ltv']} baselines); audit rows for this plan: {audit[0]['n']}.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
