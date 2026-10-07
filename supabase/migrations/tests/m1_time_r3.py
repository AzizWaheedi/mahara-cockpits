#!/usr/bin/env python3
"""Milestone 1, video-link round 3, the TIME angle, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_time_r3.py

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) is run against
missed-call Meet rooms whose deadlines sit one second either side of now():

  A. control: the link went 10 minutes and 1 second ago and nothing went
     after it: R4 closes the room, lead_no_show;
  B. the link went on WhatsApp 15 minutes and 1 second ago and the setter's
     "Also send by email" went 6 minutes and 1 second ago: that email says
     "I'll be there for the next 10 minutes", and sales-api moved lead_by to
     its send + 10 minutes (3 minutes 59 seconds from now). The setter is in
     the Meet but never pressed I'm in (Meet sends no join signal), so the
     room is still `open`: R3 (host_by, the room's open + 15 minutes, one
     second ago) closes it now, "Closed: the host did not join in time.",
     inside the ten minutes the email promised;
  C. control: the same room with I'm in pressed (host_in): kept open for
     the email's ten minutes;
  D. control: one second either side of lead_by (now() - 1 s closes,
     now() + 1 s stays).

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1t3-', people end with '@stress.invalid'.
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

ROOMS = {
    "A": "00000000-0000-4000-8000-0000000c3a01",
    "B": "00000000-0000-4000-8000-0000000c3a02",
    "C": "00000000-0000-4000-8000-0000000c3a03",
    "D1": "00000000-0000-4000-8000-0000000c3a04",
    "D2": "00000000-0000-4000-8000-0000000c3a05",
}

CHECKS = r"""
create temp table m1t3_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1t3-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1t3')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it (a manager sets
-- fallback.scope any, which m1-scope allows).
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1t3-boss@stress.invalid', true);
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
       updated_by = 'stress-m1t3-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- The rooms, each with its own lead and its own setter (one room per lead
-- and per host). opened = now() - 15 min 1 s: host_by (open + 15 min, as the
-- guard trigger stamps it on the move to open) passed one second ago.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, last_link_at, link_channels, host_in_at, host_by, lead_by, ends_at, trigger, version)
values
  -- A. control: the link 10 min 1 s ago, nothing after it.
  ('%(A)s', gen_random_uuid(), 'stress-m1t3-lead-a', 'fallback', 'intro', 'meet',
   'stress-m1t3-a@stress.invalid', 'stress-m1t3-a@stress.invalid', 'open',
   'https://meet.google.com/stress-mt3-aaa', 'stress-m1t3-evt-a', now() - interval '10 minutes 10 seconds',
   now() - interval '10 minutes 9 seconds', now() - interval '10 minutes 5 seconds', now() - interval '10 minutes 5 seconds',
   now() - interval '10 minutes 1 second', null, '{whatsapp_text}', null,
   now() + interval '4 minutes 55 seconds', now() - interval '1 second', now() + interval '19 minutes 55 seconds', 'no_answer', 3),
  -- B. the WhatsApp link 15 min 1 s ago, "Also send by email" 6 min 1 s ago (lead_by = that + 10 min).
  ('%(B)s', gen_random_uuid(), 'stress-m1t3-lead-b', 'fallback', 'intro', 'meet',
   'stress-m1t3-b@stress.invalid', 'stress-m1t3-b@stress.invalid', 'open',
   'https://meet.google.com/stress-mt3-bbb', 'stress-m1t3-evt-b', now() - interval '15 minutes 10 seconds',
   now() - interval '15 minutes 9 seconds', now() - interval '15 minutes 1 second', now() - interval '15 minutes 1 second',
   now() - interval '15 minutes 1 second', now() - interval '6 minutes 1 second', '{whatsapp_text,email}', null,
   now() - interval '1 second', now() + interval '3 minutes 59 seconds', now() + interval '14 minutes 59 seconds', 'no_answer', 3),
  -- C. control: B with I'm in pressed.
  ('%(C)s', gen_random_uuid(), 'stress-m1t3-lead-c', 'fallback', 'intro', 'meet',
   'stress-m1t3-c@stress.invalid', 'stress-m1t3-c@stress.invalid', 'host_in',
   'https://meet.google.com/stress-mt3-ccc', 'stress-m1t3-evt-c', now() - interval '15 minutes 10 seconds',
   now() - interval '15 minutes 9 seconds', now() - interval '15 minutes 1 second', now() - interval '15 minutes 1 second',
   now() - interval '15 minutes 1 second', now() - interval '6 minutes 1 second', '{whatsapp_text,email}', now() - interval '14 minutes',
   now() - interval '1 second', now() + interval '3 minutes 59 seconds', now() + interval '14 minutes 59 seconds', 'no_answer', 4),
  -- D1. control: lead_by one second ago (host in).
  ('%(D1)s', gen_random_uuid(), 'stress-m1t3-lead-d1', 'fallback', 'intro', 'meet',
   'stress-m1t3-d1@stress.invalid', 'stress-m1t3-d1@stress.invalid', 'host_in',
   'https://meet.google.com/stress-mt3-ddd', 'stress-m1t3-evt-d1', now() - interval '10 minutes 10 seconds',
   now() - interval '10 minutes 9 seconds', now() - interval '10 minutes 5 seconds', now() - interval '10 minutes 5 seconds',
   now() - interval '10 minutes 1 second', null, '{email}', now() - interval '9 minutes',
   now() + interval '4 minutes 55 seconds', now() - interval '1 second', now() + interval '19 minutes 55 seconds', 'no_answer', 4),
  -- D2. control: lead_by one second ahead (host in).
  ('%(D2)s', gen_random_uuid(), 'stress-m1t3-lead-d2', 'fallback', 'intro', 'meet',
   'stress-m1t3-d2@stress.invalid', 'stress-m1t3-d2@stress.invalid', 'host_in',
   'https://meet.google.com/stress-mt3-eee', 'stress-m1t3-evt-d2', now() - interval '9 minutes 68 seconds',
   now() - interval '9 minutes 67 seconds', now() - interval '9 minutes 63 seconds', now() - interval '9 minutes 63 seconds',
   now() - interval '9 minutes 59 seconds', null, '{email}', now() - interval '9 minutes',
   now() + interval '4 minutes 57 seconds', now() + interval '1 second', now() + interval '19 minutes 57 seconds', 'no_answer', 4);

create temp table m1t3_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1t3_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1t3_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1t3_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1t3_sweep);

insert into pg_temp.m1t3_checks (name, ok, detail)
select 'control: A (the link 10 min 1 s ago, nothing after it) is closed lead_no_show',
       r.state = 'expired' and r.end_reason = 'lead_no_show',
       format('state %s, end_reason %s', r.state, r.end_reason)
  from public.cockpit_sales_rooms as r where r.id = '%(A)s';

insert into pg_temp.m1t3_checks (name, ok, detail)
select 'B: a room whose later email promised "I''ll be there for the next 10 minutes" 6 min 1 s ago is still open (its lead_by is 3 min 59 s away)',
       r.state = 'open',
       format('state %s, end_reason %s, result %s, lead_by - now() = %s, host_by - now() = %s, its line: %s',
              r.state, r.end_reason, r.result, r.lead_by - now(), r.host_by - now(),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(B)s';

insert into pg_temp.m1t3_checks (name, ok, detail)
select 'control: C (the same with I''m in pressed) is kept open for the email''s ten minutes',
       r.state = 'host_in',
       format('state %s, end_reason %s', r.state, r.end_reason)
  from public.cockpit_sales_rooms as r where r.id = '%(C)s';

insert into pg_temp.m1t3_checks (name, ok, detail)
select 'control: one second either side of lead_by: D1 (a second ago) closes, D2 (a second ahead) stays',
       (select state from public.cockpit_sales_rooms where id = '%(D1)s') = 'expired'
         and (select state from public.cockpit_sales_rooms where id = '%(D2)s') = 'host_in',
       format('D1 %s, D2 %s', (select state from public.cockpit_sales_rooms where id = '%(D1)s'),
              (select state from public.cockpit_sales_rooms where id = '%(D2)s'));

select name, ok, detail from pg_temp.m1t3_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1t3-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1t3-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c3a%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c3a%%'
   or actor_email like 'stress-m1t3-%%'
"""


def fill(sql: str) -> str:
    for k, v in ROOMS.items():
        sql = sql.replace(f"%({k})s", v)
    return sql


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
    before = q(LEFTOVERS.replace("%%", "%"), write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = q(compose(), write=True)
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(LEFTOVERS.replace("%%", "%"), write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
