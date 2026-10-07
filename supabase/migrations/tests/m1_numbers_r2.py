#!/usr/bin/env python3
"""Milestone 1, video-link round 2, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r2.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3: rooms on for the test contact,
Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
auto_on_miss off, rooms.short_link OFF "until the call site is deployed",
live and live.slack off), and then the SQL watchdog (the database's own
guardian, which posts to #sales-alerts) is read against the truth:

  A. control: a failing Slack status row while Slack is fenced off (live
     and live.slack off) raises no alert: the watchdog reads the switch;
  B. a failing short-link status row (sales-live/open or /go) while
     rooms.short_link is off raises no alert either: no message carries
     call.maharamedia.com, so no lead opens a link through those routes,
     and "Leads may not be able to open their room links" is not true.
     The door writes that row for a request nobody in the pilot made: a
     flood of guessed codes (FLOOD_LINE, sales-live
     stress2_security_door.test.ts), or any GET while IP_SALT is unset.

A FAIL is a finding; checks named "control" pass. Synthetic rows only: the
manager ends in '@stress.invalid'; the status rows written here are the
door's own keys, put back by the rollback. Nothing is committed, so the
pg_cron jobs never see them and no post reaches Slack (pg_net's queue is
rolled back).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

FLOOD_LINE = ("The door is turning away a flood of unknown call codes (over 600 lookups a minute found no room). "
              "Leads whose link opened lately still get through; the rest are asked to wait a minute.")
SALT_LINE = "Opens cannot be recorded yet: IP_SALT is missing on sales-live. Add it to the function's secrets."
SLACK_LINE = ("Slack requests cannot be checked yet: SLACK_SIGNING_SECRET is missing on sales-live. "
              "Add it to the function's secrets.")

CHECKS = r"""
create temp table m1n2_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1n2-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1n2')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it; short_link off.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1n2-boss@stress.invalid', true);
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
       updated_by = 'stress-m1n2-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- The door's rows as a stray request leaves them (the door writes them
-- with merge-duplicates on worker, job).
insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
values ('sales-live', 'slack', false, '%(slack)s', now()),
       ('sales-live', 'open', false, '%(flood)s', now()),
       ('sales-live', 'go', false, '%(salt)s', now())
on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

create temp table m1n2_wd on commit drop as select public.cockpit_sales_watchdog() as out;

insert into pg_temp.m1n2_checks (name, ok, detail)
select 'control: Slack fenced off (live and live.slack off): a failing sales-live/slack row raises no alert',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key = 'failing:sales-live/slack' and a.resolved_at is null),
       format('watchdog: %s', (select out from pg_temp.m1n2_wd));

insert into pg_temp.m1n2_checks (name, ok, detail)
select 'short link off: a failing sales-live/open row (a flood of guessed codes) raises no alert telling #sales-alerts leads cannot open their links',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key = 'failing:sales-live/open' and a.resolved_at is null),
       coalesce((select a.message from public.cockpit_sales_alerts as a
                  where a.dedupe_key = 'failing:sales-live/open' and a.resolved_at is null), 'no alert');

insert into pg_temp.m1n2_checks (name, ok, detail)
select 'short link off: a failing sales-live/go row (IP_SALT unset for a part not in use) raises no alert',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key = 'failing:sales-live/go' and a.resolved_at is null),
       coalesce((select a.message from public.cockpit_sales_alerts as a
                  where a.dedupe_key = 'failing:sales-live/go' and a.resolved_at is null), 'no alert');

select name, ok, detail from pg_temp.m1n2_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1n2-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1n2-boss@stress.invalid'
union all
select 'status ' || worker || '/' || job from public.cockpit_sales_worker_status
 where worker = 'sales-live' and detail in ('%(flood)s', '%(salt)s', '%(slack)s')
"""


def fill(sql: str) -> str:
    esc = lambda s: s.replace("'", "''")  # noqa: E731
    return (sql.replace("%(flood)s", esc(FLOOD_LINE)).replace("%(salt)s", esc(SALT_LINE))
            .replace("%(slack)s", esc(SLACK_LINE)))


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
