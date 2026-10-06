#!/usr/bin/env python3
"""Milestone 1, video-link round 5, the TIME angle, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_time_r5.py
    python3 supabase/migrations/tests/m1_time_r5.py --print-sql | python3 sq.py triage --write

The repo's 20261003d and 20261004a (20261004a is not applied in production
yet) are applied inside the transaction, the rooms setting is switched to the
pilot's values by a manager (m1-scope.md section 3), and the SQL sweep
(cockpit_sales_rooms_sweep, the pg_cron job's own function) is run against
lead-page Zoom rooms (purpose manual) whose host has not joined Zoom yet:

  H. HighLevel took no send for the link's ten minutes of re-asks, so
     sales-api said the link did not go (final: "Copy the link and send it
     another way") and started the lead's ten minutes for the rep's own
     delivery (rooms.ts startLeadWait: lead_by now + 10 minutes, 5 minutes
     ahead now). host_by (the open + 15 minutes) passed 54 s ago. The room
     the rep was told to deliver by hand should wait those ten minutes;
  K. control: the same room whose link went late (HighLevel took the 9:54
     re-ask): sales-api's keepHostWait moved host_by to lead_by + open_grace,
     so it waits;
  E. control: H once its ten minutes are over (lead_by 1 s ago): closed.

And the open grace (R4) one second either side of those ten minutes, with
the host in Zoom (host_in), the lead in Zoom's waiting room 30 s ago:

  G. the link left to the rep (final refusal), the rep's ten minutes over
     1 s ago (lead_by), the room opened 20 minutes ago: the knock should
     hold the room open_grace (3 minutes) as any knock inside the lead's
     ten minutes does;
  J. control: the same knock on a room whose link went (link_sent_at 10 min
     1 s ago, lead_by 1 s ago): held.

And what the screens read as the close of a night read-out room:

  N. control (the rule the room line and "open until" must say): a Meet
     room made at night on the lead's clock, read out, the host not yet in
     (open), no lead_by, host_by 4 min 59 s ahead, opened 10 min 1 s ago:
     R4 closes it now as link_not_sent (the panel's countdown and the other
     seat's "open until" name host_by instead: m1_time_r5_ui.test.ts).

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1t5-', people end with '@stress.invalid'.
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
    "H": "00000000-0000-4000-8000-0000000c5501",
    "K": "00000000-0000-4000-8000-0000000c5502",
    "E": "00000000-0000-4000-8000-0000000c5503",
    "G": "00000000-0000-4000-8000-0000000c5504",
    "J": "00000000-0000-4000-8000-0000000c5505",
    "N": "00000000-0000-4000-8000-0000000c5506",
}

NIGHT = "It is night where the lead is, so no message went. Read the link out if you are speaking with them."

FINAL = "HighLevel did not take the link in 10 minutes (HighLevel said 429: Too Many Requests)."

CHECKS = r"""
create temp table m1t5_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1t5-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1t5')
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
       updated_by = 'stress-m1t5-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- Each room its own lead and its own setter (one room per lead and per host).
-- Opened 15 min 54 s ago (15:01:06 when the sweep runs at 15:17:00); the
-- link claimed at the open; host_by the open + 15 minutes, as the worker and
-- sales-api's openRoom write it.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
values
  ('%(H)s', gen_random_uuid(), 'stress-m1t5-lead-h', 'manual', 'intro', 'zoom',
   'stress-m1t5-h@stress.invalid', 'stress-m1t5-h@stress.invalid', 'open',
   'https://us06web.zoom.us/j/85550000001?pwd=stressm1t5h', '85550000001', now() - interval '16 minutes',
   now() - interval '15 minutes 59 seconds', now() - interval '15 minutes 54 seconds', now() - interval '15 minutes 54 seconds',
   null, '{}', '%(FINAL)s',
   now() - interval '54 seconds', now() + interval '5 minutes', now() + interval '14 minutes 6 seconds', 'manual', 6),
  ('%(K)s', gen_random_uuid(), 'stress-m1t5-lead-k', 'manual', 'intro', 'zoom',
   'stress-m1t5-k@stress.invalid', 'stress-m1t5-k@stress.invalid', 'open',
   'https://us06web.zoom.us/j/85550000002?pwd=stressm1t5k', '85550000002', now() - interval '16 minutes',
   now() - interval '15 minutes 59 seconds', now() - interval '15 minutes 54 seconds', now() - interval '15 minutes 54 seconds',
   now() - interval '6 minutes', '{email}', null,
   now() + interval '7 minutes', now() + interval '4 minutes', now() + interval '14 minutes 6 seconds', 'manual', 6),
  ('%(E)s', gen_random_uuid(), 'stress-m1t5-lead-e', 'manual', 'intro', 'zoom',
   'stress-m1t5-e@stress.invalid', 'stress-m1t5-e@stress.invalid', 'open',
   'https://us06web.zoom.us/j/85550000003?pwd=stressm1t5e', '85550000003', now() - interval '21 minutes',
   now() - interval '20 minutes 59 seconds', now() - interval '20 minutes 54 seconds', now() - interval '20 minutes 54 seconds',
   null, '{}', '%(FINAL)s',
   now() - interval '5 minutes 54 seconds', now() - interval '1 second', now() + interval '9 minutes 6 seconds', 'manual', 6);

-- N: the night read-out Meet room, open, no lead_by.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_by, lead_by, ends_at, trigger, version)
values
  ('%(N)s', gen_random_uuid(), 'stress-m1t5-lead-n', 'manual', 'intro', 'meet',
   'stress-m1t5-n@stress.invalid', 'stress-m1t5-n@stress.invalid', 'open',
   'https://meet.google.com/stm-tfvn-nnn', 'stm-tfvn-nnn', now() - interval '10 minutes 7 seconds',
   now() - interval '10 minutes 6 seconds', now() - interval '10 minutes 1 second', now() - interval '10 minutes 1 second',
   null, '{}', '%(NIGHT)s', now() + interval '4 minutes 59 seconds', null, now() + interval '19 minutes 59 seconds', 'manual', 4);

-- G and J: the host in Zoom (host_in), the lead in Zoom's waiting room 30 s
-- ago, lead_by 1 s ago. G's lead_by came from startLeadWait (the link left
-- to the rep 10 minutes ago); J's from its link (sent 10 min 1 s ago).
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, refusal, host_in_at, lead_waiting_at, host_by, lead_by, ends_at,
                                        trigger, version)
values
  ('%(G)s', gen_random_uuid(), 'stress-m1t5-lead-g', 'manual', 'intro', 'zoom',
   'stress-m1t5-g@stress.invalid', 'stress-m1t5-g@stress.invalid', 'host_in',
   'https://us06web.zoom.us/j/85550000004?pwd=stressm1t5g', '85550000004', now() - interval '20 minutes 6 seconds',
   now() - interval '20 minutes 5 seconds', now() - interval '20 minutes', now() - interval '20 minutes',
   null, '{}', '%(FINAL)s', now() - interval '9 minutes', now() - interval '30 seconds',
   now() - interval '5 minutes', now() - interval '1 second', now() + interval '10 minutes', 'manual', 7),
  ('%(J)s', gen_random_uuid(), 'stress-m1t5-lead-j', 'manual', 'intro', 'zoom',
   'stress-m1t5-j@stress.invalid', 'stress-m1t5-j@stress.invalid', 'host_in',
   'https://us06web.zoom.us/j/85550000005?pwd=stressm1t5j', '85550000005', now() - interval '20 minutes 6 seconds',
   now() - interval '20 minutes 5 seconds', now() - interval '20 minutes', now() - interval '20 minutes',
   now() - interval '10 minutes 1 second', '{email}', null, now() - interval '9 minutes', now() - interval '30 seconds',
   now() + interval '2 minutes 59 seconds', now() - interval '1 second', now() + interval '10 minutes', 'manual', 7);

create temp table m1t5_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1t5_checks (name, ok, detail)
select 'control: the sweep ran (no other sweep held its lock, no rule failed)',
       (select out ? 'skipped' from pg_temp.m1t5_sweep) is not true
         and coalesce(jsonb_array_length((select out -> 'errors' from pg_temp.m1t5_sweep)), 0) = 0,
       (select (out - 'tick' - 'replay' - 'settle')::text from pg_temp.m1t5_sweep);

insert into pg_temp.m1t5_checks (name, ok, detail)
select 'control: K (the link went late, host_by moved past lead_by + open_grace) is still open',
       r.state = 'open',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(K)s';

insert into pg_temp.m1t5_checks (name, ok, detail)
select 'control: E (the rep''s ten minutes over 1 s ago) is closed',
       r.state = 'expired',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(E)s';

-- H: the link left to the rep 5 minutes ago with ten minutes to deliver it
-- (lead_by 5 minutes ahead); host_by passed 54 s ago. Found when it fails:
-- R3 extends the host's wait to lead_by + open_grace only for a room whose
-- link_sent_at is set, so it closes the room host_not_in, result no_join,
-- and the room worker deletes its Zoom meeting (nobody joined): the link the
-- rep sent by hand is dead five minutes into the ten.
insert into pg_temp.m1t5_checks (name, ok, detail)
select 'H: the room whose link the rep was told to send by hand waits the ten minutes sales-api started for it (lead_by 5 min ahead), never closed at host_by',
       r.state = 'open',
       format('state %s, end_reason %s, result %s, its line: %s', r.state, coalesce(r.end_reason, '-'), coalesce(r.result, 'null'),
              coalesce((select e.text from public.cockpit_sales_room_events as e
                         where e.room_id = r.id and e.source = 'sweep' order by e.at desc limit 1), '-'))
  from public.cockpit_sales_rooms as r where r.id = '%(H)s';

insert into pg_temp.m1t5_checks (name, ok, detail)
select 'control: N (night read-out, open, opened 10 min 1 s ago, host_by 4 min 59 s ahead) is closed now as link_not_sent: the close the room line must count down to',
       r.state = 'expired' and r.end_reason = 'link_not_sent',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, coalesce(r.result, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(N)s';

insert into pg_temp.m1t5_checks (name, ok, detail)
select 'control: J (the link went 10 min 1 s ago, lead_by 1 s ago, a knock 30 s ago) is held for the knock (host_in)',
       r.state = 'host_in',
       format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result)
  from public.cockpit_sales_rooms as r where r.id = '%(J)s';

-- G: found when it fails: R4's grace cap is the latest link (or, with none,
-- the open) + lead + open_grace, so for ten minutes sales-api started at a
-- final refusal (no link_sent_at) the cap is the open + 13 minutes, long
-- before lead_by: the knock gets no grace and the lead at Zoom's door is
-- closed out (not_admitted) inside the minute.
insert into pg_temp.m1t5_checks (name, ok, detail)
select 'G: the lead knocking 30 s before the end of the ten minutes the rep was given (link left to the rep) is held open_grace, as J''s knock is',
       r.state = 'host_in',
       format('state %s, end_reason %s, result %s', r.state, coalesce(r.end_reason, '-'), coalesce(r.result, 'null'))
  from public.cockpit_sales_rooms as r where r.id = '%(G)s';

select name, ok, detail from pg_temp.m1t5_checks order by n;
"""

LEFTOVERS = r"""
select 'person ' || email as what from public.cockpit_sales_people where email like 'stress-m1t5-%%'
union all
select 'room ' || id::text from public.cockpit_sales_rooms where contact_id like 'stress-m1t5-%%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where room_id::text like '00000000-0000-4000-8000-0000000c55%%'
union all
select 'audit ' || action from public.cockpit_audit_log where entity_id like '00000000-0000-4000-8000-0000000c55%%'
   or actor_email like 'stress-m1t5-%%'
"""


def fill(sql: str) -> str:
    for k, v in ROOMS.items():
        sql = sql.replace(f"%({k})s", v)
    return sql.replace("%(FINAL)s", FINAL.replace("'", "''")).replace("%(NIGHT)s", NIGHT.replace("'", "''"))


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
