#!/usr/bin/env python3
"""Milestone 1, video-link round 4 (again), NUMBERS AND RECORDS, on the live
database (Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r4b.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3), and the SQL watchdog (the
database's own guardian, which posts to #sales-alerts) is read against what
the room host check's own status row says. The host check (desk.py rooms
--check-hosts, every 10 minutes) checks every seat's Zoom and the Google
sign-in that makes every Meet room; its row is ok false whenever Google is
not ready or a Zoom participant report could not be read
(desk/rooms.py check_hosts: ok = zoom keys and google_ok is True and the
report check), with its own sentence saying what it found.

  A. control: a host check that stopped (its row 3 hours old) raises
     "stale:sales-desk/room-hosts" saying Zoom seats and Google sign-ins are
     not being checked: true;
  B. a host check that ran a minute ago and found Google refusing the CEO's
     sign-in ("so Meet rooms cannot be made"): the alert must not say the
     seats and the sign-in are not being checked; they were, and the check
     found the sign-in broken;
  C. a host check that ran a minute ago, found Google and every seat ready,
     and could not read one Zoom participant report: the same.

A FAIL is a finding; checks named "control" pass. Synthetic rows only: the
manager ends in '@stress.invalid'; the status row written here is put back by
the rollback. Nothing is committed, so the pg_cron jobs never see it and no
post reaches Slack (pg_net's queue is rolled back).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

# desk/rooms.py check_hosts' detail, line by line as it writes them (check_google,
# zoom_seat, the default-room line, report_check), for two seats.
GOOGLE_REFUSED = ("Google refused the sign-in in GOOGLE_CAL_* (invalid_grant), so Meet rooms cannot be made. "
                  "Ask the CEO to connect Google Calendar again. "
                  "setter-m1n4b@stress.invalid (setter): Zoom licensed, so Zoom rooms have no time limit. Default room: Meet. "
                  "Meet rooms will fail for this seat until its Meet works: the rep uses Zoom. "
                  "Zoom participant reports: no Zoom room ended in the last day.")
REPORT_UNREAD = ("Google: signed in with GOOGLE_CAL_*; the Sales rooms calendar is ready. "
                 "closer-m1n4b@stress.invalid (closer): Zoom licensed, so Zoom rooms have no time limit. Default room: Zoom. "
                 "Zoom participant reports: 1 report could not be read (Zoom answered 400: Only available for paid "
                 "account); it is tried again in ten minutes.")
NOT_CHECKED = "not being checked"

CHECKS = r"""
create temp table m1n4b_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1n4b-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1n4b')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1n4b-boss@stress.invalid', true);
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
       updated_by = 'stress-m1n4b-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Every alert about the host check as it stands before the run: put back by the rollback.
delete from public.cockpit_sales_alerts where dedupe_key like '%%sales-desk/room-hosts%%';

-- A. control: the host check stopped three hours ago (its last row said ok).
insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
values ('sales-desk', 'room-hosts', true, '%(report_unread)s', now() - interval '3 hours')
on conflict (worker, job) do update set ok = excluded.ok, detail = excluded.detail, at = excluded.at;
create temp table m1n4b_wd_a on commit drop as select public.cockpit_sales_watchdog() as out;
insert into pg_temp.m1n4b_checks (name, ok, detail)
select 'control: a host check that stopped 3 hours ago raises an alert that says seats and sign-ins are not being checked',
       exists (select 1 from public.cockpit_sales_alerts as a
                where a.dedupe_key = 'stale:sales-desk/room-hosts' and a.resolved_at is null
                  and a.message ilike '%%%(not_checked)s%%'),
       coalesce((select a.message from public.cockpit_sales_alerts as a
                  where a.dedupe_key = 'stale:sales-desk/room-hosts' and a.resolved_at is null),
                'no alert; watchdog said ' || (select out::text from pg_temp.m1n4b_wd_a));
delete from public.cockpit_sales_alerts where dedupe_key like '%%sales-desk/room-hosts%%';

-- B. The host check ran a minute ago and found Google refusing the sign-in.
update public.cockpit_sales_worker_status
   set ok = false, detail = '%(google_refused)s', at = now() - interval '1 minute'
 where worker = 'sales-desk' and job = 'room-hosts';
create temp table m1n4b_wd_b on commit drop as select public.cockpit_sales_watchdog() as out;
insert into pg_temp.m1n4b_checks (name, ok, detail)
select 'a host check that ran a minute ago and found the Google sign-in refused: no alert says seats and sign-ins are not being checked',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key like '%%:sales-desk/room-hosts' and a.resolved_at is null
                      and a.message ilike '%%%(not_checked)s%%'),
       coalesce((select string_agg(a.dedupe_key || ': ' || a.message, ' | ') from public.cockpit_sales_alerts as a
                  where a.dedupe_key like '%%:sales-desk/room-hosts' and a.resolved_at is null),
                'no alert; watchdog said ' || (select out::text from pg_temp.m1n4b_wd_b));
delete from public.cockpit_sales_alerts where dedupe_key like '%%sales-desk/room-hosts%%';

-- C. The host check ran a minute ago, everything ready, one Zoom report unread.
update public.cockpit_sales_worker_status
   set ok = false, detail = '%(report_unread)s', at = now() - interval '1 minute'
 where worker = 'sales-desk' and job = 'room-hosts';
create temp table m1n4b_wd_c on commit drop as select public.cockpit_sales_watchdog() as out;
insert into pg_temp.m1n4b_checks (name, ok, detail)
select 'a host check that ran a minute ago with Google and every seat ready and one Zoom report unread: no alert says seats and sign-ins are not being checked',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key like '%%:sales-desk/room-hosts' and a.resolved_at is null
                      and a.message ilike '%%%(not_checked)s%%'),
       coalesce((select string_agg(a.dedupe_key || ': ' || a.message, ' | ') from public.cockpit_sales_alerts as a
                  where a.dedupe_key like '%%:sales-desk/room-hosts' and a.resolved_at is null),
                'no alert; watchdog said ' || (select out::text from pg_temp.m1n4b_wd_c));

select name, ok, detail from pg_temp.m1n4b_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1n4b-%%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1n4b-boss@stress.invalid'
union all
select 'status ' || worker || '/' || job from public.cockpit_sales_worker_status
 where worker = 'sales-desk' and job = 'room-hosts' and detail in ('%(google_refused)s', '%(report_unread)s')
"""


def fill(sql: str) -> str:
    esc = lambda s: s.replace("'", "''")  # noqa: E731
    return (sql.replace("%(google_refused)s", esc(GOOGLE_REFUSED)).replace("%(report_unread)s", esc(REPORT_UNREAD))
            .replace("%(not_checked)s", NOT_CHECKED).replace("%%", "%"))


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
