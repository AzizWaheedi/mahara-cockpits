#!/usr/bin/env python3
"""Milestone 1, video-link round 4 (second run), the TIME angle, on the live
database (Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_time_r4b.py
    python3 supabase/migrations/tests/m1_time_r4b.py --print-sql | python3 sq.py triage --write

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) is run against
lead-page Meet rooms (purpose manual) whose host pressed I'm in one second
either side of the lead's ten minutes:

  N. night on the lead's clock: no message went (sales-api's nightHolds),
     the room says "It is night where the lead is, so no message went. Read
     the link out if you are speaking with them.", the link claimed at the
     open, never sent, no lead_by (recordNotSent never starts the lead's
     wait for a night read-out). host_in 10 min 1 s ago: R4 closes it as
     link_not_sent with no result (the m1 round 3b "unstarted" rule), which
     since round 4 is a timer close sales-api's lateLeadIn reopens for a late
     "The lead is in" (m1_time_r4b.test.ts);
  O. control: N one second earlier (host_in 9 min 59 s ago): still host_in;
  D. control, by day: a final refusal (no message could go) left the link to
     the rep, so sales-api started the lead's wait (lead_by, 1 s ago): R4
     closes it as the lead's no-show, which a late press does reopen.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1t4b-', people end with '@stress.invalid'.
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
    "N": "00000000-0000-4000-8000-0000000c4b01",
    "O": "00000000-0000-4000-8000-0000000c4b02",
    "D": "00000000-0000-4000-8000-0000000c4b03",
}

NIGHT = "It is night where the lead is, so no message went. Read the link out if you are speaking with them."
FINAL = "No message can reach this lead. Read the link out if you are speaking with them."

CHECKS = r"""
create temp table m1t4b_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1t4b-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1t4b')
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
       updated_by = 'stress-m1t4b-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Each room its own lead and its own setter (one room per lead and per host).
-- Opened 10 min 26 s ago (N, D) or 10 min 24 s ago (O); I'm in 20 s after the
-- open; host_by as the worker fills it (open + 15 minutes).
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_in_at, host_by, lead_by, ends_at, trigger, version)
values
  ('%(N)s', gen_random_uuid(), 'stress-m1t4b-lead-n', 'manual', 'intro', 'meet',
   'stress-m1t4b-n@stress.invalid', 'stress-m1t4b-n@stress.invalid', 'host_in',
   'https://meet.google.com/stn-mtfb-nnn', 'stn-mtfb-nnn', now() - interval '10 minutes 32 seconds',
   now() - interval '10 minutes 31 seconds', now() - interval '10 minutes 26 seconds', now() - interval '10 minutes 26 seconds',
   null, '{}', '%(NIGHT)s', now() - interval '10 minutes 1 second',
   now() + interval '4 minutes 34 seconds', null, now() + interval '19 minutes 34 seconds', 'manual', 4),
  ('%(O)s', gen_random_uuid(), 'stress-m1t4b-lead-o', 'manual', 'intro', 'meet',
   'stress-m1t4b-o@stress.invalid', 'stress-m1t4b-o@stress.invalid', 'host_in',
   'https://meet.google.com/stn-mtfb-ooo', 'stn-mtfb-ooo', now() - interval '10 minutes 30 seconds',
   now() - interval '10 minutes 29 seconds', now() - interval '10 minutes 24 seconds', now() - interval '10 minutes 24 seconds',
   null, '{}', '%(NIGHT)s', now() - interval '9 minutes 59 seconds',
   now() + interval '4 minutes 36 seconds', null, now() + interval '19 minutes 36 seconds', 'manual', 4),
  ('%(D)s', gen_random_uuid(), 'stress-m1t4b-lead-d', 'manual', 'intro', 'meet',
   'stress-m1t4b-d@stress.invalid', 'stress-m1t4b-d@stress.invalid', 'host_in',
   'https://meet.google.com/stn-mtfb-ddd', 'stn-mtfb-ddd', now() - interval '10 minutes 32 seconds',
   now() - interval '10 minutes 31 seconds', now() - interval '10 minutes 26 seconds', now() - interval '10 minutes 26 seconds',
   null, '{}', '%(FINAL)s', now() - interval '10 minutes 6 seconds',
   now() + interval '4 minutes 34 seconds', now() - interval '1 second', now() + interval '19 minutes 34 seconds', 'manual', 4);

create temp table m1t4b_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1t4b_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1t4b_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1t4b_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1t4b_sweep);

insert into pg_temp.m1t4b_checks (name, ok, detail)
select 'control: O (the night read-out, I''m in 9 min 59 s ago) is still host_in',
       r.state = 'host_in',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(O)s';

insert into pg_temp.m1t4b_checks (name, ok, detail)
select 'control: D (by day, the link left to the rep, lead_by 1 s ago) is closed lead_no_show, result no_join',
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(D)s';

-- N's close: the rule sales-api's late "The lead is in" (lateLeadIn, its
-- TIMER_END_REASONS) and the panel both read. Since the round 4 fix,
-- link_not_sent is in TIMER_END_REASONS and TIMER_CLOSES (sales-api
-- m1_time_r4b.test.ts keeps the late join and makes the knock's replacement
-- on it), so the close only has to be a timer's, with no result decided.
insert into pg_temp.m1t4b_checks (name, ok, detail)
select 'N: the night read-out (I''m in 10 min 1 s ago) closes with a timer''s reason a late "The lead is in" can still reopen (link_not_sent or lead_no_show), no no_join decided on a link that never went',
       r.state = 'expired' and r.end_reason in ('link_not_sent', 'lead_no_show')
         and (r.end_reason = 'lead_no_show' or r.result is null),
       format('state %s, end_reason %s, result %s, its line: %s', r.state, r.end_reason, coalesce(r.result, 'null'),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(N)s';

select name, ok, detail from pg_temp.m1t4b_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1t4b-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1t4b-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c4b%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c4b%%'
   or actor_email like 'stress-m1t4b-%%'
"""


def fill(sql: str) -> str:
    for k, v in ROOMS.items():
        sql = sql.replace(f"%({k})s", v)
    return sql.replace("%(NIGHT)s", NIGHT.replace("'", "''")).replace("%(FINAL)s", FINAL.replace("'", "''"))


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
