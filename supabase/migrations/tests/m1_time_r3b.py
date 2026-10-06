#!/usr/bin/env python3
"""Milestone 1, video-link round 3 (second pass), TIME, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_time_r3b.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values, and the sweep's R4 is run on two setters' Meet rooms opened eleven
minutes ago whose link was claimed and never went:

  control. The link's refusal was final ("Not sent: ... Read it out"), so the
     link was left to the rep and the lead's ten minutes started (lead_by):
     past them the room closes as the lead's no-show (lead_no_show, no_join).
  night. Night on the lead's clock stopped the link (rooms.ts nightHolds,
     m1 round 3b, retried-link-cut-by-night-after-press-grace): nothing went
     and sales-api never started the lead's ten minutes (lead_by empty). The
     room closes as link_not_sent with no result, never the lead's no-show.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1t3b-', people end with '@stress.invalid'.
Nothing is committed, so the pg_cron jobs never see the rows and no post
reaches sales-live or Slack (pg_net's queue is rolled back).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

ROOM_FINAL = "00000000-0000-4000-8000-0000000d3b01"
ROOM_NIGHT = "00000000-0000-4000-8000-0000000d3b02"

CHECKS = r"""
create temp table m1t3b_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1t3b-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1t3b')
on conflict (email) do nothing;

update public.cockpit_sales_settings
   set value = value || jsonb_build_object(
         'enabled', true, 'test_only', true, 'settle', false, 'wrap', false, 'count_on_join', false, 'short_link', false,
         'providers', '{"meet": true, "zoom": true}'::jsonb,
         'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
       updated_by = 'stress-m1t3b-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        host_by, lead_by, ends_at, refusal, version)
values
  ('%(final)s', gen_random_uuid(), 'stress-m1t3b-lead-a', 'manual', 'intro', 'meet',
   'stress-m1t3b-setter-a@stress.invalid', 'stress-m1t3b-setter-a@stress.invalid', 'open',
   'https://meet.google.com/m1t-3bf-aaa', 'evt-m1t3b-a', now() - interval '12 minutes', now() - interval '12 minutes',
   now() - interval '11 minutes', now() - interval '11 minutes', now() + interval '10 minutes', now() - interval '1 minute',
   now() + interval '19 minutes', 'Not sent: HighLevel did not take the link in 10 minutes (HighLevel said 429). Read it out: meet.google.com/m1t-3bf-aaa.', 3),
  ('%(night)s', gen_random_uuid(), 'stress-m1t3b-lead-b', 'manual', 'intro', 'meet',
   'stress-m1t3b-setter-b@stress.invalid', 'stress-m1t3b-setter-b@stress.invalid', 'open',
   'https://meet.google.com/m1t-3bn-bbb', 'evt-m1t3b-b', now() - interval '12 minutes', now() - interval '12 minutes',
   now() - interval '11 minutes', now() - interval '11 minutes', now() + interval '10 minutes', null,
   now() + interval '19 minutes', 'It is night where the lead is, so no message went. Read the link out if you are speaking with them.', 3);

create temp table m1t3b_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1t3b_checks (name, ok, detail)
select 'control: the sweep ran with no rule in error',
       (select out ->> 'skipped' from pg_temp.m1t3b_sweep) is null
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1t3b_sweep)), 0) = 0,
       format('skipped %s; errors %s', coalesce((select out ->> 'skipped' from pg_temp.m1t3b_sweep), 'no'),
              (select out -> 'errors' from pg_temp.m1t3b_sweep));

insert into pg_temp.m1t3b_checks (name, ok, detail)
select 'control: a link left to the rep (final refusal, the lead''s ten minutes over) closes as the lead''s no-show',
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(final)s';

insert into pg_temp.m1t3b_checks (name, ok, detail)
select 'm1-time-r3b-retried-link-cut-by-night-after-press-grace (the close): night stopped a link that never went and the lead''s ten minutes never started: the room closes as link_not_sent with no result, never the lead''s no-show',
       r.state = 'expired' and r.end_reason = 'link_not_sent' and r.result is null,
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(night)s';

select name, ok, detail from pg_temp.m1t3b_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-m1t3b-%' or host_email like 'stress-m1t3b-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id in ('%(final)s', '%(night)s')
union all
select 'person ' || email from public.cockpit_sales_people where email like 'stress-m1t3b-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1t3b-boss@stress.invalid'
   or entity_id in ('%(final)s', '%(night)s')
"""


def fill(sql: str) -> str:
    return sql.replace("%(final)s", ROOM_FINAL).replace("%(night)s", ROOM_NIGHT)


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
