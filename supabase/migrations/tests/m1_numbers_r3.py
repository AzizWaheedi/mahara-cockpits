#!/usr/bin/env python3
"""Milestone 1, video-link round 3, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r3.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3), and the SQL watchdog (the
database's own guardian, which posts to #sales-alerts) is read against what
the room worker's own status row says:

  A. control: a row that says the worker makes no rooms ("Not making rooms:
     ...", desk/rooms.py NOT_MAKING) raises "failing:sales-desk/rooms" saying
     new video rooms cannot be made: true;
  B. a row from a worker that IS making rooms and reports ok false for a
     passing fault (desk/rooms.py sentence(): "The database did not answer 1
     time; the worker kept trying." sets ok false) raises the same alert,
     whose words end "New video rooms cannot be made." beside the worker's
     own "3 rooms made". The alert must not say rooms cannot be made when the
     row says they were.

A FAIL is a finding; checks named "control" pass. Synthetic rows only: the
manager ends in '@stress.invalid'; the status row written here is put back by
the rollback. Nothing is committed, so the pg_cron jobs never see it and no
post reaches Slack (pg_net's queue is rolled back; outside working hours the
watchdog posts nothing anyway).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

# desk/rooms.py sentence(), word for word, for the two cases.
NOT_MAKING = ("Not making rooms: The rooms setting could not be read, so no new room is made until it can be. "
              "Working. No rooms were asked for in the last 60 seconds.")
DB_BLIP = ("Working. In the last 60 seconds: 3 rooms made (0 Zoom, 3 Meet), 0 failed, 0 closed. "
           "The database did not answer 1 time; the worker kept trying.")

CHECKS = r"""
create temp table m1n3_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1n3-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1n3')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
update public.cockpit_sales_settings
   set value = value || jsonb_build_object(
         'enabled', true,
         'test_only', true,
         'settle', false,
         'wrap', false,
         'count_on_join', false,
         'short_link', false,
         'providers', '{"meet": true, "zoom": true}'::jsonb,
         'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
       updated_by = 'stress-m1n3-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- A. control: the worker running and making no rooms.
insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
values ('sales-desk', 'rooms', false, '%(not_making)s', now())
on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
create temp table m1n3_wd_a on commit drop as select public.cockpit_sales_watchdog() as out;
insert into pg_temp.m1n3_checks (name, ok, detail)
select 'control: a row that says the worker makes no rooms raises an alert that says new rooms cannot be made',
       exists (select 1 from public.cockpit_sales_alerts as a
                where a.dedupe_key = 'failing:sales-desk/rooms' and a.resolved_at is null
                  and a.message ilike '%%cannot be made%%'),
       coalesce((select a.message from public.cockpit_sales_alerts as a
                  where a.dedupe_key = 'failing:sales-desk/rooms' and a.resolved_at is null), 'no alert');
delete from public.cockpit_sales_alerts where dedupe_key = 'failing:sales-desk/rooms';

-- B. The worker making rooms, ok false for a passing database blip.
update public.cockpit_sales_worker_status
   set ok = false, detail = '%(db_blip)s', at = now()
 where worker = 'sales-desk' and job = 'rooms';
create temp table m1n3_wd_b on commit drop as select public.cockpit_sales_watchdog() as out;
insert into pg_temp.m1n3_checks (name, ok, detail)
select 'a worker whose row says it made 3 rooms in the last minute (ok false for one database blip it rode out): no alert says new video rooms cannot be made',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key = 'failing:sales-desk/rooms' and a.resolved_at is null
                      and a.message ilike '%%cannot be made%%'),
       coalesce((select a.message from public.cockpit_sales_alerts as a
                  where a.dedupe_key = 'failing:sales-desk/rooms' and a.resolved_at is null), 'no alert');

select name, ok, detail from pg_temp.m1n3_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1n3-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1n3-boss@stress.invalid'
union all
select 'status ' || worker || '/' || job from public.cockpit_sales_worker_status
 where worker = 'sales-desk' and job = 'rooms' and detail in ('%(not_making)s', '%(db_blip)s')
"""


def fill(sql: str) -> str:
    esc = lambda s: s.replace("'", "''")  # noqa: E731
    return sql.replace("%(not_making)s", esc(NOT_MAKING)).replace("%(db_blip)s", esc(DB_BLIP)).replace("%%", "%")


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             fill(CHECKS), "rollback;"]
    sql = "\n".join(parts)
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return sql


def main():
    before = q(fill(LEFTOVERS), write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = q(compose(), write=True)
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(fill(LEFTOVERS), write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
