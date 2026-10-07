#!/usr/bin/env python3
"""Milestone 1, video-link round 5, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r5.py

The repo's 20261003d and 20261004a (20261004a not applied in production yet)
are applied inside the transaction, and the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3). What must hold: every
switch change, on or off, leaves one settings.switch audit row (runbook,
"Turning a switch on"), and the row names who made the change.

"Turning a switch off needs no manager" (the settings guard, 20261004a): a
kill switch is any write that turns rooms off, by whoever holds the database
(the runbook's own SQL shape, without updated_by). The guard takes the row's
actor from new.updated_by, which such a write leaves as it was: the
manager who switched the pilot on. The audit row then says that manager
switched rooms off.

  A. control: the pilot's switch-on, stamped by the manager, leaves one
     settings.switch row naming the manager;
  B. a kill switch written without updated_by (as the runbook allows) leaves
     one settings.switch row, and that row does not name the manager who
     never made it.

A FAIL is a finding; checks named "control" pass. Synthetic rows only: the
manager ends in '@stress.invalid'. Nothing is committed, so the pg_cron jobs
never see the switches and no post reaches Slack.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

BOSS = "stress-m1n5-boss@stress.invalid"

CHECKS = r"""
create temp table m1n5_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('%(boss)s', 'Stress Boss', 'manager', true, 'stress-m1n5')
on conflict (email) do nothing;

-- A. The pilot's switch-on, as m1-scope.md section 3 writes it.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', '%(boss)s', true);
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
       updated_by = '%(boss)s', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
insert into pg_temp.m1n5_checks (name, ok, detail)
select 'control: the pilot''s switch-on by the manager leaves one settings.switch row naming the manager',
       count(*) = 1 and bool_and(a.actor_email = '%(boss)s'),
       coalesce(string_agg(coalesce(a.actor_email, '(none)') || ' ' || a.after::text, ' | '), 'no row')
  from public.cockpit_audit_log as a
 where a.action = 'settings.switch' and a.entity_id = 'rooms'
   and a.after ->> 'rooms.enabled' = 'true' and a.metadata ->> 'by' = '%(boss)s';

-- B. The kill switch: rooms off, by whoever holds the database, as the
-- runbook allows ("Turning a switch off needs no manager"), without updated_by.
update public.cockpit_sales_settings
   set value = jsonb_set(value, '{enabled}', 'false')
 where key = 'rooms';
insert into pg_temp.m1n5_checks (name, ok, detail)
select 'a kill switch written without updated_by leaves one settings.switch row, and it does not say the manager who switched the pilot on made it',
       count(*) = 1 and bool_and(coalesce(a.actor_email, '') <> '%(boss)s' and coalesce(a.metadata ->> 'by', '') <> '%(boss)s'),
       coalesce(string_agg('actor ' || coalesce(a.actor_email, '(none)') || ', by ' || coalesce(a.metadata ->> 'by', '(none)')
                           || ', changed ' || coalesce(a.metadata ->> 'changed', ''), ' | '), 'no row')
  from public.cockpit_audit_log as a
 where a.action = 'settings.switch' and a.entity_id = 'rooms'
   and a.before ->> 'rooms.enabled' = 'true' and a.after ->> 'rooms.enabled' = 'false';

select name, ok, detail from pg_temp.m1n5_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email = '%(boss)s'
union all
select 'audit ' || action from public.cockpit_audit_log
 where action = 'settings.switch' and (metadata ->> 'by' = '%(boss)s' or actor_email = '%(boss)s')
"""


def fill(sql: str) -> str:
    return sql.replace("%(boss)s", BOSS)


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
