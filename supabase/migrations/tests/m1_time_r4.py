#!/usr/bin/env python3
"""Milestone 1, video-link round 4, the TIME angle, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_time_r4.py
    python3 supabase/migrations/tests/m1_time_r4.py --print-sql | python3 sq.py triage --write

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) is run against
the setter's Zoom rooms for a booked intro whose deadlines sit one second
either side of now():

  A. control: the link went by email 10 minutes and 1 second ago and nothing
     after it: R4 closes the room, lead_no_show, result no_join;
  B. the link has never gone: the room opened 10 minutes and 1 second ago
     (lead_by, as sales-api's readyOnOpen stamps it at the open: open + 10
     minutes), its link was claimed at the open and HighLevel refused every
     send with 429, so the room says "HighLevel did not take the link yet
     (...), so it is tried again in a minute" and the minute's re-ask is still
     running (roomlogic.ts reaskPlan: link_claimed_at set, link_sent_at
     null). R4 must not close it as the lead's no-show ("Closed: the lead did
     not join in 10 minutes.", result no_join): the lead was never sent a
     link, and once closed the re-ask stops, so the link never goes;
  C. control: B one second earlier (lead_by one second ahead): still open.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1t4-', people end with '@stress.invalid'.
Nothing is committed, so the pg_cron jobs never see the rows and no post
reaches sales-live or Slack (the sweep is called directly; pg_net's queue is
rolled back with everything else).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

ROOMS = {
    "A": "00000000-0000-4000-8000-0000000c4a01",
    "B": "00000000-0000-4000-8000-0000000c4a02",
    "C": "00000000-0000-4000-8000-0000000c4a03",
}

REFUSAL = ("HighLevel did not take the link yet (HighLevel did not send it: HighLevel said 429: Too Many Requests), "
           "so it is tried again in a minute.")

CHECKS = r"""
create temp table m1t4_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1t4-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1t4')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1t4-boss@stress.invalid', true);
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
       updated_by = 'stress-m1t4-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Each room its own lead and its own setter (one room per lead and per host).
-- The room opened 10 min 6 s ago (A, B) or 9 min 54 s ago (C); host_by as the
-- guard trigger stamps it on the move to open (open + 15 minutes).
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
values
  -- A. control: the email went at the open, 10 min 1 s ago (lead_by = that + 10 min).
  ('%(A)s', gen_random_uuid(), 'stress-m1t4-lead-a', 'fallback', 'intro', 'zoom',
   'stress-m1t4-a@stress.invalid', 'stress-m1t4-a@stress.invalid', 'open',
   'https://us06web.zoom.us/j/81000000001?pwd=stressm1t4a', '81000000001', now() - interval '10 minutes 12 seconds',
   now() - interval '10 minutes 11 seconds', now() - interval '10 minutes 6 seconds', now() - interval '10 minutes 6 seconds',
   now() - interval '10 minutes 1 second', '{email}', null,
   now() + interval '4 minutes 54 seconds', now() - interval '1 second', now() + interval '19 minutes 54 seconds', 'no_answer', 3),
  -- B. the link never went: claimed at the open, refused with 429 each minute since; lead_by = open + 10 min.
  ('%(B)s', gen_random_uuid(), 'stress-m1t4-lead-b', 'fallback', 'intro', 'zoom',
   'stress-m1t4-b@stress.invalid', 'stress-m1t4-b@stress.invalid', 'open',
   'https://us06web.zoom.us/j/81000000002?pwd=stressm1t4b', '81000000002', now() - interval '10 minutes 6 seconds',
   now() - interval '10 minutes 5 seconds', now() - interval '10 minutes 1 second', now() - interval '10 minutes 1 second',
   null, '{}', '%(REFUSAL)s',
   now() + interval '4 minutes 59 seconds', now() - interval '1 second', now() + interval '19 minutes 59 seconds', 'no_answer', 3),
  -- C. control: B one second earlier.
  ('%(C)s', gen_random_uuid(), 'stress-m1t4-lead-c', 'fallback', 'intro', 'zoom',
   'stress-m1t4-c@stress.invalid', 'stress-m1t4-c@stress.invalid', 'open',
   'https://us06web.zoom.us/j/81000000003?pwd=stressm1t4c', '81000000003', now() - interval '10 minutes 4 seconds',
   now() - interval '10 minutes 3 seconds', now() - interval '9 minutes 59 seconds', now() - interval '9 minutes 59 seconds',
   null, '{}', '%(REFUSAL)s',
   now() + interval '5 minutes 1 second', now() + interval '1 second', now() + interval '20 minutes 1 second', 'no_answer', 3);

create temp table m1t4_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1t4_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1t4_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1t4_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1t4_sweep);

insert into pg_temp.m1t4_checks (name, ok, detail)
select 'control: A (the email 10 min 1 s ago, nothing after it) is closed lead_no_show',
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(A)s';

insert into pg_temp.m1t4_checks (name, ok, detail)
select 'B: a room whose link never went (still "tried again in a minute") is not closed as the lead''s no-show',
       not (r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join'),
       format('state %s, end_reason %s, result %s, link_sent_at %s, its line: %s',
              r.state, r.end_reason, r.result, coalesce(r.link_sent_at::text, 'null'),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(B)s';

insert into pg_temp.m1t4_checks (name, ok, detail)
select 'control: C (B one second earlier, lead_by a second ahead) is still open',
       r.state = 'open',
       format('state %s, end_reason %s', r.state, r.end_reason)
  from public.cockpit_sales_rooms as r where r.id = '%(C)s';

select name, ok, detail from pg_temp.m1t4_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1t4-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1t4-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c4a%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c4a%%'
   or actor_email like 'stress-m1t4-%%'
"""


def fill(sql: str) -> str:
    for k, v in ROOMS.items():
        sql = sql.replace(f"%({k})s", v)
    return sql.replace("%(REFUSAL)s", REFUSAL.replace("'", "''"))


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
    if "--print-sql" in sys.argv:
        # The one rolled-back transaction, for the session's own runner
        # (sq.py triage --write < it): it ends in the checks' rows.
        sys.stdout.write(compose())
        return
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
