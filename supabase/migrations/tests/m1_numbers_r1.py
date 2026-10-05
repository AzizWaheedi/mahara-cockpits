#!/usr/bin/env python3
"""Milestone 1, video-link round 1, NUMBERS AND RECORDS, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/m1_numbers_r1.py

The repo's 20261003d and 20261004a (not applied in production yet) are
applied inside the transaction, the rooms setting is switched to the pilot's
values by a manager (m1-scope.md section 3: rooms on for the test contact,
Meet and Zoom on, every send channel on, count_on_join, settle, wrap and
auto_on_miss off, live off), and then:

  A. control: the pilot's switch-on leaves one settings.switch audit row
     naming the manager and every switch that went on;
  B. control: a setter's fallback room for a booked intro whose lead never
     came is closed by the sweep with ONE room.sweep audit row; with
     rooms.settle off nothing settles: no settle event, no settled_mark, no
     "mark this intro" alert, no disposition, the intro's status as it was
     (no show-rate number moves because of the room);
  C. the watchdog's alerts read the truth over time: a room's Zoom report
     alert (room_report:{room}, raised by the host check when Zoom's
     participant report and the cockpit disagree) is resolved like every
     other per-room alert once it is days old and was posted, so the open
     count (the watchdog's own row, the guardian's live-alerts check) does
     not only grow. Nothing in the cockpit, sales-api or the desk ever
     resolves it.

A FAIL is a finding; checks named "control" pass. Synthetic rows only:
contact and appointment ids start with 'stress-m1n-', people end with
'@stress.invalid'. Nothing is committed, so the pg_cron jobs never see the
rows and no post reaches sales-live or Slack (pg_net's queue is rolled back).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"

CHECKS = r"""
create temp table m1n_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_people (email, name, role, active, updated_by)
values ('stress-m1n-boss@stress.invalid', 'Stress Boss', 'manager', true, 'stress-m1n')
on conflict (email) do nothing;

-- The pilot's switch-on, as m1-scope.md section 3 writes it.
update public.cockpit_sales_settings
   set value = value || jsonb_build_object(
         'enabled', true,
         'test_only', true,
         'settle', false,
         'wrap', false,
         'count_on_join', false,
         'providers', '{"meet": true, "zoom": true}'::jsonb,
         'send', '{"whatsapp_text": true, "whatsapp_template": true, "email": true}'::jsonb),
       updated_by = 'stress-m1n-boss@stress.invalid', updated_at = clock_timestamp()
 where key = 'rooms';
update public.cockpit_sales_settings
   set value = jsonb_set(jsonb_set(value, '{enabled}', 'false'), '{slack}', 'false')
 where key = 'live';

insert into pg_temp.m1n_checks (name, ok, detail)
select 'control: the pilot switch-on leaves one settings.switch row naming the manager and what went on',
       count(*) = 1 and bool_and(a.actor_email = 'stress-m1n-boss@stress.invalid')
         and bool_and(a.metadata -> 'turned_on' ?& array['rooms.enabled', 'rooms.providers.meet', 'rooms.providers.zoom', 'rooms.send.email']),
       format('%s rows: %s', count(*), coalesce(string_agg(a.metadata ->> 'turned_on', ' | '), '-'))
  from public.cockpit_audit_log as a
 where a.action = 'settings.switch' and a.entity_id = 'rooms' and a.created_at >= now();

-- B. A setter's video link after a missed intro call: the room opened, the
-- link went by email 12 minutes ago, the lead never came (lead_by passed).
insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, booked_at, status, assigned_user_id, origin)
values ('stress-m1n-intro-1', 'stress-m1n-lead-1', 'intro', '%(intro)s', now() - interval '14 minutes', now() - interval '2 days',
        'confirmed', 'G-stress-m1n-setter', 'b2b');

insert into public.cockpit_sales_rooms (id, request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
                                        join_url, provider_meeting_id, requested_at, claimed_at, opened_at, link_claimed_at,
                                        link_sent_at, link_channels, host_by, lead_by, ends_at, appointment_id, appointment_start_at, version)
values ('00000000-0000-4000-8000-00000000a001', gen_random_uuid(), 'stress-m1n-lead-1', 'fallback', 'intro', 'meet',
        'stress-m1n-setter@stress.invalid', 'stress-m1n-setter@stress.invalid', 'open',
        'https://meet.google.com/stress-mnum-aaa', 'stress-m1n-evt-1', now() - interval '13 minutes', now() - interval '13 minutes',
        now() - interval '12 minutes', now() - interval '12 minutes', now() - interval '12 minutes', '{email}',
        now() + interval '3 minutes', now() - interval '2 minutes', now() + interval '18 minutes',
        'stress-m1n-intro-1', now() - interval '14 minutes', 3);

create temp table m1n_sweep on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1n_checks (name, ok, detail)
select 'control: the sweep closes the room once, as a no-show of the room, with one room.sweep audit row',
       r.state = 'expired' and r.result = 'no_join'
         and (select count(*) from public.cockpit_audit_log as a where a.action = 'room.sweep' and a.entity_id = r.id::text) = 1,
       format('state %s, result %s, end_reason %s, audit rows %s, sweep errors %s', r.state, r.result, r.end_reason,
              (select count(*) from public.cockpit_audit_log as a where a.entity_id = r.id::text),
              (select out -> 'errors' from pg_temp.m1n_sweep))
  from public.cockpit_sales_rooms as r where r.id = '00000000-0000-4000-8000-00000000a001';

-- The intro's start + settle (20 min) has not come yet: run the sweep again
-- at +25 minutes by moving the room's and the intro's times back.
update public.cockpit_sales_appointments set start_at = start_at - interval '25 minutes' where appointment_id = 'stress-m1n-intro-1';
update public.cockpit_sales_rooms
   set appointment_start_at = appointment_start_at - interval '25 minutes'
 where id = '00000000-0000-4000-8000-00000000a001';
create temp table m1n_sweep2 on commit drop as select public.cockpit_sales_rooms_sweep() as out;

insert into pg_temp.m1n_checks (name, ok, detail)
select 'control: with rooms.settle off nothing settles: no settle event, no settled_mark, no mark-intro alert, no disposition, the intro as it was',
       not exists (select 1 from public.cockpit_sales_room_events as e where e.room_id = r.id and (e.source = 'settle' or e.kind like 'sweep.settle%%'))
         and r.settled_mark is null
         and not exists (select 1 from public.cockpit_sales_alerts as al where al.dedupe_key like 'room:' || r.id::text || '%%')
         and not exists (select 1 from public.cockpit_sales_dispositions as d where d.appointment_id = 'stress-m1n-intro-1')
         and (select status from public.cockpit_sales_appointments where appointment_id = 'stress-m1n-intro-1') = 'confirmed'
         and coalesce(jsonb_array_length((select out -> 'settle' from pg_temp.m1n_sweep2)), 0) = 0,
       format('settled_mark %s, settle posted %s, settle_off %s',
              coalesce(r.settled_mark, 'null'), (select out -> 'settle' from pg_temp.m1n_sweep2),
              (select out -> 'settle_off' from pg_temp.m1n_sweep2))
  from public.cockpit_sales_rooms as r where r.id = '00000000-0000-4000-8000-00000000a001';

-- C. Two alerts about that room from eight days ago, both posted to Slack
-- seven days ago and never answered by a person: the host check's Zoom
-- report and the room's mark-intro alert.
insert into public.cockpit_sales_alerts (dedupe_key, source, kind, subject, message, detail, raised_at, last_seen_at, posted_at, post_tries, post_status)
values ('room_report:00000000-0000-4000-8000-00000000a001', 'sales-desk', 'room_report', 'Room STRESS',
        'Room STRESS: the cockpit marked the lead in, but Zoom''s report shows nobody outside the team. Check the room''s joins.',
        '{"stress": "m1n"}', now() - interval '8 days', now() - interval '8 days', now() - interval '7 days', 1, 200),
       ('room:00000000-0000-4000-8000-00000000a001:mark_intro', 'watchdog', 'room_mark_intro', 'Room STRESS',
        'Room STRESS: stress control alert.', '{"stress": "m1n"}', now() - interval '8 days', now() - interval '8 days',
        now() - interval '7 days', 1, 200);

create temp table m1n_wd on commit drop as select public.cockpit_sales_watchdog() as out;

insert into pg_temp.m1n_checks (name, ok, detail)
select 'control: the watchdog resolves a per-room alert a week old that was posted',
       exists (select 1 from public.cockpit_sales_alerts as a
                where a.dedupe_key like 'room:00000000-0000-4000-8000-00000000a001:mark_intro:resolved:%%' and a.resolved_at is not null),
       format('watchdog: %s', (select out from pg_temp.m1n_wd));

insert into pg_temp.m1n_checks (name, ok, detail)
select 'a Zoom report alert a week old that was posted is resolved too, so the open alert count does not only grow',
       not exists (select 1 from public.cockpit_sales_alerts as a
                    where a.dedupe_key = 'room_report:00000000-0000-4000-8000-00000000a001' and a.resolved_at is null),
       format('still open: %s; watchdog open count %s',
              (select count(*) from public.cockpit_sales_alerts as a
                where a.dedupe_key = 'room_report:00000000-0000-4000-8000-00000000a001' and a.resolved_at is null),
              (select out -> 'open' from pg_temp.m1n_wd));

select name, ok, detail from pg_temp.m1n_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-m1n-%' or host_email like 'stress-m1n-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-m1n-%'
union all
select 'alert ' || dedupe_key from public.cockpit_sales_alerts where detail ->> 'stress' = 'm1n'
union all
select 'person ' || email from public.cockpit_sales_people where email like 'stress-m1n-%'
union all
select 'audit ' || action from public.cockpit_audit_log where metadata ->> 'by' = 'stress-m1n-boss@stress.invalid'
"""


def compose() -> str:
    parts = ["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '100s';",
             "-- ===== 20261003d + 20261004a (the repo's, idempotent) =====", run_checks.hardening_sql(),
             CHECKS.replace("%(intro)s", INTRO_CAL).replace("%%", "%"), "rollback;"]
    sql = "\n".join(parts)
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return sql


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = q(compose(), write=True)
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = q(LEFTOVERS, write=False)
    if after:
        print("LEFT BEHIND:", json.dumps([r["what"] for r in after]))
        sys.exit(1)
    print("Nothing persisted.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
