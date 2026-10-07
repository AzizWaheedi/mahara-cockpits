#!/usr/bin/env python3
"""Milestone 1, video-link round 3 (journeys), the SQL side, on the live
database (Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_journeys_r3.py
    python3 supabase/migrations/tests/m1_journeys_r3.py --print-sql | python3 sq.py triage --write

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) runs once over
the rooms of the cockpit journeys in
apps/sales-cockpit/src/lib/m1_journeys_r3b_ui.test.ts, at the moment each
journey reads the screens:

  B. (journey r3b-B) the setter's Zoom room after the missed intro: the link
     went by email 10 minutes and 1 second ago, the host never came in, the
     lead has been waiting for the host for 6 minutes (Zoom's jbh_waiting,
     lead_waiting_at). The sweep closes it on the knock: expired,
     not_admitted, result admit_blocked; that is the closed room whose screens
     say "send a new link" while room.create answers link_already_sent;
  C. (journey r3b-C) the setter's Meet room after the missed intro: The lead
     is in 22 minutes ago, nobody pressed Finished, ends_at 5.5 minutes ahead.
     The sweep leaves it lead_in, so at the call-back 25 minutes after the
     miss the dialer still reads a join from it;
  A. (journey r3b-A) the setter's Meet room ended by End room 2 minutes ago
     while its link was still "tried again in a minute": the sweep leaves the
     closed room as the press left it (ended, no_join, no link_sent_at).

These are the journeys' preconditions on the real rules (each check is a
control, and passes); the failures themselves are in the cockpit file.
Synthetic rows only: contact ids start with 'stress-m1j3b-', people end with
'@stress.invalid'. Nothing is committed, so the pg_cron jobs never see the
rows and no post reaches sales-live or Slack (the sweep is called directly;
pg_net's queue is rolled back with everything else).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

ROOMS = {
    "A": "00000000-0000-4000-8000-0000000c3b01",
    "B": "00000000-0000-4000-8000-0000000c3b02",
    "C": "00000000-0000-4000-8000-0000000c3b03",
}

REFUSAL = ("HighLevel did not take the link yet (HighLevel did not send it: HighLevel said 429: Too many requests), "
           "so it is tried again in a minute.")

CHECKS = r"""
create temp table m1j3b_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1j3b-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1j3b')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1j3b-boss@stress.invalid', true);
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
       updated_by = 'stress-m1j3b-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Each room its own lead and its own setter (one room per lead and per host).
insert into public.cockpit_sales_rooms (id, request_id, contact_id, contact_first_name, purpose, call_kind, provider, host_email,
                                        made_by, state, join_url, provider_meeting_id, requested_at, claimed_at, opened_at,
                                        link_claimed_at, link_sent_at, link_channels, refusal, host_by, lead_by, ends_at,
                                        lead_waiting_at, host_in_at, lead_in_at, trigger, version)
values
  -- B. Zoom, the host never in, the email 10 min 1 s ago (lead_by = it + 10 min), the lead waiting 6 min.
  ('%(B)s', gen_random_uuid(), 'stress-m1j3b-lead-b', 'Huda', 'fallback', 'intro', 'zoom',
   'stress-m1j3b-b@stress.invalid', 'stress-m1j3b-b@stress.invalid', 'open',
   'https://us06web.zoom.us/j/81000000302?pwd=stressm1j3b', '81000000302', now() - interval '10 minutes 12 seconds',
   now() - interval '10 minutes 11 seconds', now() - interval '10 minutes 6 seconds', now() - interval '10 minutes 6 seconds',
   now() - interval '10 minutes 1 second', '{email}', null,
   now() + interval '4 minutes 54 seconds', now() - interval '1 second', now() + interval '19 minutes 54 seconds',
   now() - interval '6 minutes', null, null, 'no_answer', 3),
  -- C. Meet, The lead is in 22 min ago, nobody pressed Finished; ends_at = the open + 30 min.
  ('%(C)s', gen_random_uuid(), 'stress-m1j3b-lead-c', 'Huda', 'fallback', 'intro', 'meet',
   'stress-m1j3b-c@stress.invalid', 'stress-m1j3b-c@stress.invalid', 'lead_in',
   'https://meet.google.com/abc-defg-hij', 'evt-m1j3b-c', now() - interval '24 minutes 40 seconds',
   now() - interval '24 minutes 38 seconds', now() - interval '24 minutes 30 seconds', now() - interval '24 minutes 30 seconds',
   now() - interval '24 minutes 20 seconds', '{email}', null,
   now() - interval '9 minutes 30 seconds', now() - interval '14 minutes 20 seconds', now() + interval '5 minutes 30 seconds',
   null, now() - interval '23 minutes', now() - interval '22 minutes', 'no_answer', 5);

-- A. Meet, ended by End room 2 min ago while its link was still tried again.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, contact_first_name, purpose, call_kind, provider, host_email,
                                        made_by, state, join_url, provider_meeting_id, requested_at, claimed_at, opened_at,
                                        link_claimed_at, link_sent_at, link_channels, refusal, host_by, lead_by, ends_at,
                                        result, ended_at, trigger, version)
values
  ('%(A)s', gen_random_uuid(), 'stress-m1j3b-lead-a', 'Huda', 'fallback', 'intro', 'meet',
   'stress-m1j3b-a@stress.invalid', 'stress-m1j3b-a@stress.invalid', 'ended',
   'https://meet.google.com/abc-defg-hia', 'evt-m1j3b-a', now() - interval '5 minutes 40 seconds',
   now() - interval '5 minutes 38 seconds', now() - interval '5 minutes 30 seconds', now() - interval '5 minutes 30 seconds',
   null, '{}', '%(REFUSAL)s',
   now() + interval '9 minutes 30 seconds', null, now() + interval '24 minutes 30 seconds',
   'no_join', now() - interval '2 minutes', 'no_answer', 4);

create temp table m1j3b_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1j3b_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1j3b_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1j3b_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1j3b_sweep);

insert into pg_temp.m1j3b_checks (name, ok, detail)
select 'control (r3b-B): the Zoom room the lead waited in for the host closes on her knock (expired, not_admitted, admit_blocked)',
       r.state = 'expired' and r.end_reason = 'not_admitted' and r.result = 'admit_blocked' and r.link_sent_at is not null,
       format('state %s, end_reason %s, result %s, link_sent_at %s', r.state, r.end_reason, r.result,
              coalesce(r.link_sent_at::text, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(B)s';

insert into pg_temp.m1j3b_checks (name, ok, detail)
select 'control (r3b-C): the Meet room with The lead is in 22 minutes ago and no Finished is still lead_in',
       r.state = 'lead_in' and r.lead_in_at is not null,
       format('state %s, end_reason %s, lead_in_at %s', r.state, r.end_reason, coalesce(r.lead_in_at::text, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(C)s';

insert into pg_temp.m1j3b_checks (name, ok, detail)
select 'control (r3b-A): the Meet room ended before its link went stays as the press left it',
       r.state = 'ended' and r.result = 'no_join' and r.link_sent_at is null and r.end_reason is null,
       format('state %s, result %s, end_reason %s, link_sent_at %s', r.state, r.result, r.end_reason,
              coalesce(r.link_sent_at::text, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(A)s';

select name, ok, detail from pg_temp.m1j3b_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1j3b-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1j3b-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c3b%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c3b%%'
   or actor_email like 'stress-m1j3b-%%'
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
