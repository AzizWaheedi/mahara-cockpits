#!/usr/bin/env python3
"""Milestone 1, video-link round 6, the CHAOS angle, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_chaos_r6.py
    python3 supabase/migrations/tests/m1_chaos_r6.py --print-sql | python3 sq.py triage --write

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) is run against
lead-page rooms (purpose manual) whose host has not joined yet:

  F. HighLevel took no send for the link's ten minutes of re-asks, so 30 s
     ago sales-api said it final ("Copy the link and send it another way"),
     and its startLeadWait PATCH (lead_by now + 10 minutes) met one 503 and
     never landed: lead_by is empty ("never fatal": sales-api's
     m1_chaos_r6_kill.test.ts shows nothing writes it again). The rep was
     told 30 s ago to deliver the link by hand. The room should wait for
     them, never close at the next minute (the room worker then deletes its
     Zoom meeting, nobody having joined: the hand-sent link is dead);
  C. control: F with its lead_by written (now + 9 min 30 s): it waits;
  M. a Meet room whose worker.ready sales-api could not handle in ten tries
     (a database outage of a few minutes after each lease) and the sweep's
     E0 gave up; the tick claimed and sent the link 11 minutes ago, and the
     lead's ten minutes are over (lead_by 1 minute ago), nobody pressed
     "The lead is in". A lost worker.ready says nothing about who joined (a
     Meet join is the rep's press): the room should close as the lead's
     no-show (or at least never in Zoom's words);
  N. control: M with no event given up: lead_no_show.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1c6-', people end with '@stress.invalid'.
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
    "F": "00000000-0000-4000-8000-0000000c6601",
    "C": "00000000-0000-4000-8000-0000000c6602",
    "M": "00000000-0000-4000-8000-0000000c6603",
    "N": "00000000-0000-4000-8000-0000000c6604",
}

FINAL = ("HighLevel did not take the link in 10 minutes (HighLevel did not send it: HighLevel said 429: "
         "Too Many Requests).")

CHECKS = r"""
create temp table m1c6_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1c6-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1c6')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1c6-boss@stress.invalid', true);
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
       updated_by = 'stress-m1c6-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- F and C: the setter's lead-page Zoom room, opened 10 min 40 s ago, its
-- link claimed at the open, never sent (HighLevel's 429 for ten minutes),
-- said final 30 s ago; host_by the open + 15 minutes. F's lead_by was lost
-- to a blip; C's landed.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
values
  ('%(F)s', gen_random_uuid(), 'stress-m1c6-lead-f', 'manual', 'intro', 'zoom',
   'stress-m1c6-f@stress.invalid', 'stress-m1c6-f@stress.invalid', 'open',
   'https://us06web.zoom.us/j/85660000001?pwd=stressm1c6f', '85660000001', now() - interval '10 minutes 46 seconds',
   now() - interval '10 minutes 45 seconds', now() - interval '10 minutes 40 seconds', now() - interval '10 minutes 40 seconds',
   null, '{}', '%(FINAL)s',
   now() + interval '4 minutes 20 seconds', null, now() + interval '19 minutes 20 seconds', 'manual', 6),
  ('%(C)s', gen_random_uuid(), 'stress-m1c6-lead-c', 'manual', 'intro', 'zoom',
   'stress-m1c6-c@stress.invalid', 'stress-m1c6-c@stress.invalid', 'open',
   'https://us06web.zoom.us/j/85660000002?pwd=stressm1c6c', '85660000002', now() - interval '10 minutes 46 seconds',
   now() - interval '10 minutes 45 seconds', now() - interval '10 minutes 40 seconds', now() - interval '10 minutes 40 seconds',
   null, '{}', '%(FINAL)s',
   now() + interval '4 minutes 20 seconds', now() + interval '9 minutes 30 seconds', now() + interval '19 minutes 20 seconds',
   'manual', 6);

-- M and N: the setter's lead-page Meet room, opened 14 minutes ago, its link
-- sent 11 minutes ago (by the tick's claim for M), lead_by 1 minute ago,
-- nobody pressed "The lead is in".
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
values
  ('%(M)s', gen_random_uuid(), 'stress-m1c6-lead-m', 'manual', 'intro', 'meet',
   'stress-m1c6-m@stress.invalid', 'stress-m1c6-m@stress.invalid', 'open',
   'https://meet.google.com/stm-cmsx-mmm', 'stm-cmsx-mmm', now() - interval '14 minutes 6 seconds',
   now() - interval '14 minutes 5 seconds', now() - interval '14 minutes', now() - interval '11 minutes',
   now() - interval '11 minutes', '{email}', null,
   now() + interval '4 minutes', now() - interval '1 minute', now() + interval '16 minutes', 'manual', 7),
  ('%(N)s', gen_random_uuid(), 'stress-m1c6-lead-n', 'manual', 'intro', 'meet',
   'stress-m1c6-n@stress.invalid', 'stress-m1c6-n@stress.invalid', 'open',
   'https://meet.google.com/stm-cmsx-nnn', 'stm-cmsx-nnn', now() - interval '14 minutes 6 seconds',
   now() - interval '14 minutes 5 seconds', now() - interval '14 minutes', now() - interval '11 minutes',
   now() - interval '11 minutes', '{email}', null,
   now() + interval '4 minutes', now() - interval '1 minute', now() + interval '16 minutes', 'manual', 7);

-- M's worker.ready, given up by E0 after its ten tries.
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, text, detail, handled_at, tries, last_try_at, at)
values ('%(M)s', 'worker.ready', 'worker', 'worker.ready:%(M)s', 'Room made on Meet in 3 s.',
        jsonb_build_object('worker_run', 'stress-m1c6-run', 'gave_up', true, 'gave_up_at', now() - interval '10 minutes', 'tries', 10),
        now() - interval '10 minutes', 10, now() - interval '10 minutes 30 seconds', now() - interval '14 minutes');
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, text, detail, handled_at, at)
values ('%(N)s', 'worker.ready', 'worker', 'worker.ready:%(N)s', 'Room made on Meet in 3 s.',
        jsonb_build_object('worker_run', 'stress-m1c6-run'), now() - interval '14 minutes', now() - interval '14 minutes');

create temp table m1c6_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1c6_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1c6_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1c6_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1c6_sweep);

insert into pg_temp.m1c6_checks (name, ok, detail)
select 'control: C (final refusal 30 s ago, lead_by written) waits for the rep''s delivery',
       r.state = 'open',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(C)s';

insert into pg_temp.m1c6_checks (name, ok, detail)
select 'F: the room whose link the rep was told 30 s ago to send by hand (lead_by lost to one blip) still waits for the rep''s delivery, never closed at the next minute',
       r.state = 'open',
       format('state %s, end_reason %s, result %s, its line: %s', r.state, coalesce(r.end_reason, '-'), coalesce(r.result, 'null'),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(F)s';

insert into pg_temp.m1c6_checks (name, ok, detail)
select 'control: N (Meet, link went 11 min ago, lead_by 1 min ago, no join) closes as the lead''s no-show',
       r.state = 'expired' and r.end_reason = 'lead_no_show' and r.result = 'no_join',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, coalesce(r.result, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(N)s';

insert into pg_temp.m1c6_checks (name, ok, detail)
select 'M: a Meet room whose only lost event is the worker''s worker.ready closes as N does, never as "some of Zoom''s events for this room were never read"',
       r.state = 'expired' and r.end_reason = 'lead_no_show'
         and not exists (select 1 from public.cockpit_sales_room_events as e
                          where e.room_id = r.id and e.source = 'sweep' and e.text ilike '%%Zoom%%'),
       format('state %s, end_reason %s, result %s, its line: %s', r.state, coalesce(r.end_reason, '-'), coalesce(r.result, 'null'),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(M)s';

select name, ok, detail from pg_temp.m1c6_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1c6-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1c6-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c66%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c66%%'
   or actor_email like 'stress-m1c6-%%'
"""


def fill(sql: str) -> str:
    for k, v in ROOMS.items():
        sql = sql.replace(f"%({k})s", v)
    return sql.replace("%(FINAL)s", FINAL.replace("'", "''"))


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             fill(CHECKS).replace("%%", "%"), "rollback;"]
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
