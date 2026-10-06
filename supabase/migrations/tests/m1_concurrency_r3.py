#!/usr/bin/env python3
"""Milestone 1, video-link round 3 (second pass), CONCURRENCY AND IDEMPOTENCY,
on the live database (Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_concurrency_r3.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3), and then:

  A. The sweep's replay of one call's Zoom events. sales-api did not answer
     while the door stored three of a closer's Zoom room's events (the
     closer's join at -200 s, the lead's join at -100 s, Zoom's end of the
     meeting at -60 s). The sweep's E1 picks them for a replay; the tick posts
     its list as one sweep.replay, and sales-api's replay reads the ids one
     after another in the list's order (rooms.ts replay). The list must be in
     the order the events happened (their `at`), so the lead's join is never
     read before the host's or after the meeting's end. The event ids are
     chosen so their own order is lead, end, host.
  B. The lead's join written on the room still waiting for the host (state
     open, no host_in_at: the host's join not read yet), as sales-api writes
     it (roomlogic.ts lead_in: state, lead_in_at, lead_in_seen_at, ends_at,
     version): the guard stamps host_in_at with the moment of the write.
     Read after a meeting's end that came before that moment, the end is
     taken for an earlier instance (roomlogic.ts meeting_ended: t < lastIn).
     The control shows the stamp; the check says the room's host_in_at is
     never later than the lead's own join time (the host let the lead in).

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact ids start with 'stress-m1c3-', people end with '@stress.invalid'.
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

ROOM = "00000000-0000-4000-8000-0000000c3a01"
ROOM_B = "00000000-0000-4000-8000-0000000c3b02"
ROOM_C = "00000000-0000-4000-8000-0000000c3c03"
ROOM_D = "00000000-0000-4000-8000-0000000c3d04"
# Event ids whose own order (uuid) is lead, end, host.
EV_LEAD = "00000000-0000-4000-8000-0000000c3e01"
EV_END = "00000000-0000-4000-8000-0000000c3e02"
EV_HOST = "00000000-0000-4000-8000-0000000c3e03"

CHECKS = r"""
create temp table m1c3_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1c3-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1c3')
on conflict (email) do nothing;

-- The manager names themself in the write's own transaction (round 6's settings guard).
select set_config('mahara.actor', 'stress-m1c3-boss@stress.invalid', true);
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
       updated_by = 'stress-m1c3-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
-- Nobody named for the rest of the run.
select set_config('mahara.actor', '', true);
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

-- A. A closer's manual Zoom room, opened 5 minutes ago, its link sent; the
-- closer's join, the lead's join and the meeting's end stored by the door
-- and never handled (sales-api did not answer).
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, host_by, lead_by, ends_at, version)
values ('%(room)s', gen_random_uuid(), 'stress-m1c3-lead-a', 'manual', 'demo', 'zoom',
        'stress-m1c3-closer-a@stress.invalid', 'stress-m1c3-closer-a@stress.invalid', 'open',
        'https://us06web.zoom.us/j/85550003301?pwd=x', '85550003301',
        now() - interval '6 minutes', now() - interval '6 minutes', now() - interval '5 minutes',
        now() - interval '5 minutes', now() - interval '5 minutes', '{email}',
        now() + interval '10 minutes', now() + interval '5 minutes', now() + interval '55 minutes', 3);

insert into public.cockpit_sales_room_events (id, room_id, kind, source, dedupe_key, at, text, detail)
values
  ('%(ev_host)s', '%(room)s', 'zoom.meeting.participant_joined', 'zoom', 'stress-m1c3:host', now() - interval '200 seconds',
   'Zoom: the host joined.', jsonb_build_object('event', 'meeting.participant_joined', 'payload',
     jsonb_build_object('object', jsonb_build_object('id', '85550003301', 'participant',
       jsonb_build_object('id', 'Z-stress', 'user_id', '100', 'join_time', now() - interval '200 seconds'))))),
  ('%(ev_lead)s', '%(room)s', 'zoom.meeting.participant_joined', 'zoom', 'stress-m1c3:lead', now() - interval '100 seconds',
   'Zoom: someone joined.', jsonb_build_object('event', 'meeting.participant_joined', 'payload',
     jsonb_build_object('object', jsonb_build_object('id', '85550003301', 'participant',
       jsonb_build_object('user_id', '200', 'user_name', 'Stress Lead', 'join_time', now() - interval '100 seconds'))))),
  ('%(ev_end)s', '%(room)s', 'zoom.meeting.ended', 'zoom', 'stress-m1c3:end', now() - interval '60 seconds',
   'Zoom: the meeting ended.', jsonb_build_object('event', 'meeting.ended', 'payload',
     jsonb_build_object('object', jsonb_build_object('id', '85550003301'))));

create temp table m1c3_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'control: the sweep ran and picked all three stored Zoom events for the replay',
       (select out ->> 'skipped' from pg_temp.m1c3_sweep) is null
         and (select count(*) from jsonb_array_elements_text((select out -> 'replay' from pg_temp.m1c3_sweep)) as e(v)
               where e.v in ('%(ev_host)s', '%(ev_lead)s', '%(ev_end)s')) = 3,
       format('replay list %s; skipped %s; errors %s', (select out -> 'replay' from pg_temp.m1c3_sweep),
              coalesce((select out ->> 'skipped' from pg_temp.m1c3_sweep), 'no'), (select out -> 'errors' from pg_temp.m1c3_sweep));

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'm1-conc-r3b-replay-order-lead-join-stamps-host-in-hides-meeting-end (A): the replay list is in the order the events happened (host -200 s, lead -100 s, end -60 s), so sales-api never reads the lead''s join before the host''s or the meeting''s end before the lead''s join',
       (select array_agg(e.v order by e.o) from jsonb_array_elements_text((select out -> 'replay' from pg_temp.m1c3_sweep)) with ordinality as e(v, o)
         where e.v in ('%(ev_host)s', '%(ev_lead)s', '%(ev_end)s'))
         = array['%(ev_host)s', '%(ev_lead)s', '%(ev_end)s'],
       format('posted in this order: %s',
              (select string_agg(case e.v when '%(ev_host)s' then 'host join' when '%(ev_lead)s' then 'lead join' else 'meeting end' end, ', ' order by e.o)
                 from jsonb_array_elements_text((select out -> 'replay' from pg_temp.m1c3_sweep)) with ordinality as e(v, o)
                where e.v in ('%(ev_host)s', '%(ev_lead)s', '%(ev_end)s')));

-- B. Another closer's Zoom room, open, the host's join not read; the lead's
-- join (40 s ago) written as sales-api writes it.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, host_by, lead_by, ends_at, version)
values ('%(room_b)s', gen_random_uuid(), 'stress-m1c3-lead-b', 'manual', 'demo', 'zoom',
        'stress-m1c3-closer-b@stress.invalid', 'stress-m1c3-closer-b@stress.invalid', 'open',
        'https://us06web.zoom.us/j/85550003302?pwd=x', '85550003302',
        now() - interval '6 minutes', now() - interval '6 minutes', now() - interval '5 minutes',
        now() - interval '5 minutes', now() - interval '5 minutes', '{email}',
        now() + interval '10 minutes', now() + interval '5 minutes', now() + interval '55 minutes', 3);
update public.cockpit_sales_rooms
   set state = 'lead_in', lead_in_at = now() - interval '40 seconds', lead_in_seen_at = now(),
       ends_at = now() + interval '59 minutes', version = 4
 where id = '%(room_b)s' and state = 'open' and version = 3;

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'control: the lead''s join landed on the room waiting for the host (lead_in)',
       r.state = 'lead_in', format('state %s', r.state)
  from public.cockpit_sales_rooms as r where r.id = '%(room_b)s';

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'm1-conc-r3b-replay-order-lead-join-stamps-host-in-hides-meeting-end (B): the host who let the lead in was in by the lead''s own join time; the room''s host_in_at is never the later moment of the write, which a meeting end read after it compares with',
       r.host_in_at <= r.lead_in_at,
       format('lead_in_at %s, host_in_at %s (stamped %s after the lead joined)', r.lead_in_at, r.host_in_at, r.host_in_at - r.lead_in_at)
  from public.cockpit_sales_rooms as r where r.id = '%(room_b)s';

-- C. A setter's Meet room closed by We are on the phone a minute ago, while
-- its link may have gone (HighLevel's answer lost: the link.unclear line, no
-- link_sent_at): the sweep's tick list carries it for the link's 15 minutes
-- of re-reads, so sales-api reads the lead's conversation for it once more
-- (m1-conc-r3b-unclear-link-never-settled-after-room-closes). Its twin with
-- no doubt said is not carried.
insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        host_by, ends_at, result, ended_at, refusal, version)
values ('%(room_c)s', gen_random_uuid(), 'stress-m1c3-lead-c', 'manual', 'intro', 'meet',
        'stress-m1c3-setter-c@stress.invalid', 'stress-m1c3-setter-c@stress.invalid', 'cancelled',
        'https://meet.google.com/m1c-3cc-ccc', 'evt-m1c3-c', now() - interval '3 minutes', now() - interval '3 minutes',
        now() - interval '2 minutes', now() - interval '2 minutes', now() + interval '13 minutes', now() + interval '28 minutes',
        'moved_to_phone', now() - interval '1 minute',
        'The link may have gone by email. Check the conversation before sending it again, or read it out.', 4),
       ('%(room_d)s', gen_random_uuid(), 'stress-m1c3-lead-d', 'manual', 'intro', 'meet',
        'stress-m1c3-setter-d@stress.invalid', 'stress-m1c3-setter-d@stress.invalid', 'cancelled',
        'https://meet.google.com/m1c-3dd-ddd', 'evt-m1c3-d', now() - interval '3 minutes', now() - interval '3 minutes',
        now() - interval '2 minutes', now() - interval '2 minutes', now() + interval '13 minutes', now() + interval '28 minutes',
        'moved_to_phone', now() - interval '1 minute', null, 4);
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
values ('%(room_c)s', 'link.unclear', 'sales-api', 'stress-m1c3:unclear-c', now() - interval '100 seconds',
        'The link may have gone by email. Check the conversation before sending it again, or read it out.', '{"channel": "email"}');

create temp table m1c3_sweep2 on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'control: a closed room with no doubt said about its link is not in the tick list',
       not exists (select 1 from jsonb_array_elements_text((select out -> 'tick' from pg_temp.m1c3_sweep2)) as e(v) where e.v = '%(room_d)s'),
       format('tick list %s', (select out -> 'tick' from pg_temp.m1c3_sweep2));

insert into pg_temp.m1c3_checks (name, ok, detail)
select 'm1-conc-r3b-unclear-link-never-settled-after-room-closes (C): a room closed while its link may have gone is in the tick list for the link''s re-reads, so sales-api reads the lead''s conversation for it once more',
       exists (select 1 from jsonb_array_elements_text((select out -> 'tick' from pg_temp.m1c3_sweep2)) as e(v) where e.v = '%(room_c)s'),
       format('tick list %s', (select out -> 'tick' from pg_temp.m1c3_sweep2));

select name, ok, detail from pg_temp.m1c3_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-m1c3-%' or host_email like 'stress-m1c3-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-m1c3:%' or room_id in ('%(room)s', '%(room_b)s', '%(room_c)s', '%(room_d)s')
union all
select 'person ' || email from public.cockpit_sales_people where email like 'stress-m1c3-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1c3-boss@stress.invalid'
   or entity_id in ('%(room)s', '%(room_b)s', '%(room_c)s', '%(room_d)s')
"""


def fill(sql: str) -> str:
    return (
        sql.replace("%(room)s", ROOM)
        .replace("%(room_b)s", ROOM_B)
        .replace("%(room_c)s", ROOM_C)
        .replace("%(room_d)s", ROOM_D)
        .replace("%(ev_lead)s", EV_LEAD)
        .replace("%(ev_end)s", EV_END)
        .replace("%(ev_host)s", EV_HOST)
    )


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
