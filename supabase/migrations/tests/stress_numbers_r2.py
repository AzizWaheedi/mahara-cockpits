#!/usr/bin/env python3
"""Stress round 2, numbers and data integrity, on the live database (Creative Triage).

    python3 supabase/migrations/tests/stress_numbers_r2.py

The three migrations 20261003a, b and c are applied in production (dark:
every switch off, the tables empty); 20261003d is not, so each rolled-back
run below applies it first (run_checks.hardening_sql), as round 1 does.

A. ONE transaction that ends in rollback: the real cockpit_sales_rooms_sweep()
   on synthetic closed rooms, then checks on which rooms its S1 posts to be
   settled as a no-show. A Zoom room for which Zoom reported nothing at all
   (not the meeting's start, not the host's join) is no evidence that the
   lead stayed away: "missing is never zero". The same room with Zoom's own
   start and host join stored, and no lead, is (the rule still works).
B. ONE transaction that ends in rollback: cockpit_sales_message_slot, the one
   locked step that writes a message row under the ceilings (D18, C30): a
   template that may have gone (sending, unclear) counts toward the day's
   ceiling and the month's budget; a failed one does not; the month stops at
   exactly month_cap; the sender's 30 in ten minutes counts every channel.
   Limits are set relative to the rows already there, so real rows never
   change the answer.
C. Read-only, B2B (flwboeijllbtrufxkhts): every calendar B2B's show rate
   counts (calendar_call_type_map, active) is one the count treats as
   official (sales-api BOOKING_CALENDARS plus the cockpit's calendars
   setting, type intro or demo), so no live or test booking can land on a
   calendar B2B counts without the count refusing it (C34, D25).

Synthetic rows only: contact ids start with 'stress-numbers-r2-', host and
sender emails end with '@stress.invalid'. Nothing writes HighLevel, Zoom,
Google or Slack; nothing is committed. Exit code 0 only when every check
passed and nothing persisted. A FAIL is a finding.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import b2b_read, q  # noqa: E402  (the management API call with its 429 wait)

INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"
# sales-api dialer.ts BOOKING_CALENDARS (the count's own official list).
BOOKING_CALENDARS = {"dsqmJ393Dwl9fDSbIVOI", "cFeDl0FY8iaXll61lus8", "jQqXS1YuFnmGZKLkrE62"}

SETTLE_SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
%(hardening)s
create temp table sr_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, origin)
values ('stress-numbers-r2-appt-silent', 'stress-numbers-r2-lead-silent', 'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl'),
       ('stress-numbers-r2-appt-heard',  'stress-numbers-r2-lead-heard',  'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl');

create temp table sr_rooms (name text primary key, id uuid not null) on commit drop;
with made as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id,
     state, result, end_reason, join_url, provider_meeting_id, opened_at, link_sent_at, host_in_at, ended_at)
  values
    -- 1. Zoom said nothing at all for this room: no meeting.started, no host join, no lead.
    --    The setter pressed "I'm in" by hand (the panel offers it after 30 s with no Zoom event).
    (gen_random_uuid(), 'stress-numbers-r2-lead-silent', 'fallback', 'no_answer', 'intro', 'zoom',
     'silent@stress.invalid', 'silent@stress.invalid', 'stress-numbers-r2-appt-silent', 'expired', 'no_join', 'lead_no_show',
     'https://zoom.example.invalid/j/71', '71000000001', now() - interval '24 minutes', now() - interval '23 minutes',
     now() - interval '22 minutes', now() - interval '10 minutes'),
    -- 2. Zoom reported the meeting and the host's join (both read), and no lead: evidence nobody came.
    (gen_random_uuid(), 'stress-numbers-r2-lead-heard', 'fallback', 'no_answer', 'intro', 'zoom',
     'heard@stress.invalid', 'heard@stress.invalid', 'stress-numbers-r2-appt-heard', 'expired', 'no_join', 'lead_no_show',
     'https://zoom.example.invalid/j/72', '72000000002', now() - interval '24 minutes', now() - interval '23 minutes',
     now() - interval '22 minutes', now() - interval '10 minutes')
  returning id, host_email
)
insert into pg_temp.sr_rooms (name, id)
select case host_email when 'silent@stress.invalid' then 'silent' else 'heard' end, id from made;
update public.cockpit_sales_rooms as x set requested_at = x.opened_at - interval '30 seconds'
  from pg_temp.sr_rooms as r where r.id = x.id;
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
select r.id, k.kind, 'zoom', 'stress-numbers-r2:' || r.id::text || ':' || k.kind, now() - interval '22 minutes', now() - interval '22 minutes',
       k.text, jsonb_build_object('role', k.role)
  from pg_temp.sr_rooms as r
 cross join (values ('zoom.meeting.started', 'The meeting started.', null),
                    ('zoom.meeting.participant_joined', 'The host joined.', 'host')) as k(kind, text, role)
 where r.name = 'heard';

do $$
declare
  r jsonb;
  i integer;
begin
  for i in 1 .. 20 loop
    r := public.cockpit_sales_rooms_sweep();
    exit when not (r ? 'skipped');
    perform pg_sleep(0.5);
  end loop;
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('the sweep ran here and raised no rule error', not (r ? 'skipped') and coalesce(jsonb_array_length(r -> 'errors'), 0) = 0,
          left((r -> 'errors')::text, 300));
end $$;

create function pg_temp.settle_posted(p_name text) returns boolean language sql as $$
  select exists (select 1 from public.cockpit_sales_room_events as e
                   join pg_temp.sr_rooms as r on e.room_id = r.id
                  where r.name = p_name and e.dedupe_key = 'sweep.settle:' || r.id::text)
$$;

insert into pg_temp.sr_checks (name, ok, detail) values
  ('settle-zoom-silence-read-as-no-show: a Zoom room Zoom reported nothing for (not even the host) posts no no-show',
   not pg_temp.settle_posted('silent'), 'posted: ' || pg_temp.settle_posted('silent')),
  ('a Zoom room whose start and host join Zoom reported, and no lead: posted as a no-show (the rule still works)',
   pg_temp.settle_posted('heard'), 'posted: ' || pg_temp.settle_posted('heard'));

select name, ok, detail from pg_temp.sr_checks order by n;
rollback;
"""

SLOT_SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
%(hardening)s
create temp table sr_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

do $$
declare
  day_start timestamptz := now() - interval '1 hour';
  base_day integer;
  base_sender integer;
  lim jsonb;
  a jsonb;
  i integer;
  row_ jsonb;
begin
  select count(*) into base_day from public.cockpit_sales_messages as m
   where m.via = 'workflow' and m.state <> 'failed' and m.created_at >= day_start;
  -- Three templates already this hour: one that may have gone (unclear), one still sending, one failed.
  insert into public.cockpit_sales_messages (request_id, contact_id, channel, via, template_key, body, source, sent_by, state)
  values (gen_random_uuid(), 'stress-numbers-r2-slot-a', 'whatsapp', 'workflow', 'opener_ar', 'x', 'followup', 'desk-a@stress.invalid', 'unclear'),
         (gen_random_uuid(), 'stress-numbers-r2-slot-b', 'whatsapp', 'workflow', 'opener_ar', 'x', 'followup', 'desk-a@stress.invalid', 'sending'),
         (gen_random_uuid(), 'stress-numbers-r2-slot-c', 'whatsapp', 'workflow', 'opener_ar', 'x', 'followup', 'desk-a@stress.invalid', 'failed');
  -- The day holds base + 3 (the unclear and the sending count, the failed does not): one more fits.
  lim := jsonb_build_object('sender_max', 1000, 'sender_window_s', 600, 'lead_gap_s', 120,
                            'per_day', base_day + 3, 'month_cap', 1000000,
                            'day_start', day_start, 'month_start', day_start);
  row_ := jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-d', 'channel', 'whatsapp',
                             'via', 'workflow', 'template_key', 'opener_ar', 'body', 'x', 'source', 'followup',
                             'sent_by', 'desk-b@stress.invalid');
  a := public.cockpit_sales_message_slot(row_, lim);
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('the day ceiling: a template that may have gone counts, a failed one does not (base+2 counted, one more fits)',
          a ->> 'code' = 'ok', a ->> 'code');
  row_ := row_ || jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-e');
  a := public.cockpit_sales_message_slot(row_, lim);
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('the day ceiling stops at exactly per_day', a ->> 'code' = 'per_day', a ->> 'code');

  -- The month: the same rows against month_cap.
  lim := lim || jsonb_build_object('per_day', 1000000, 'month_cap', base_day + 3);
  row_ := row_ || jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-f');
  a := public.cockpit_sales_message_slot(row_, lim);
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('the month''s budget stops at exactly month_cap (the desk''s floor(budget / rate))', a ->> 'code' = 'budget', a ->> 'code');

  -- One template a lead every two minutes: the unclear one blocks the lead.
  lim := lim || jsonb_build_object('month_cap', 1000000);
  row_ := row_ || jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-a');
  a := public.cockpit_sales_message_slot(row_, lim);
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('a template that may have gone holds the lead''s two minutes', a ->> 'code' = 'lead_gap', a ->> 'code');

  -- The sender's ceiling counts every channel: 3 rows of desk-a this hour, sender_max 4, then a text and an email.
  select count(*) into base_sender from public.cockpit_sales_messages as m
   where m.sent_by = 'desk-a@stress.invalid' and m.created_at >= now() - interval '600 seconds';
  lim := lim || jsonb_build_object('sender_max', base_sender + 1);
  a := public.cockpit_sales_message_slot(jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-g',
         'channel', 'whatsapp', 'body', 'hello', 'source', 'rep', 'sent_by', 'desk-a@stress.invalid'), lim);
  insert into pg_temp.sr_checks (name, ok, detail) values ('a free text under the sender''s ceiling goes', a ->> 'code' = 'ok', a ->> 'code');
  a := public.cockpit_sales_message_slot(jsonb_build_object('request_id', gen_random_uuid(), 'contact_id', 'stress-numbers-r2-slot-h',
         'channel', 'email', 'subject', 's', 'body', 'hello', 'source', 'rep', 'sent_by', 'desk-a@stress.invalid'), lim);
  insert into pg_temp.sr_checks (name, ok, detail)
  values ('the sender''s ceiling counts templates, texts and emails together', a ->> 'code' = 'sender_ceiling', a ->> 'code');
  -- The same request id again answers the row, and counts nothing new.
  a := public.cockpit_sales_message_slot(row_ || jsonb_build_object('contact_id', 'stress-numbers-r2-slot-d',
         'request_id', (select m.request_id from public.cockpit_sales_messages as m where m.contact_id = 'stress-numbers-r2-slot-d')), lim);
  insert into pg_temp.sr_checks (name, ok, detail) values ('a repeated request id answers repeat', a ->> 'code' = 'repeat', a ->> 'code');
end $$;

select name, ok, detail from pg_temp.sr_checks order by n;
rollback;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-numbers-r2-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-numbers-r2-%'
union all
select 'message ' || id::text from public.cockpit_sales_messages where contact_id like 'stress-numbers-r2-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-numbers-r2%'
"""


def rolled_back(sql: str) -> list:
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return q(sql, write=True)


def part_c() -> list:
    rows = q("select value from public.cockpit_sales_settings where key = 'calendars'", write=False)
    cals = (rows[0] or {}).get("value") if rows else {}
    cals = cals if isinstance(cals, dict) else {}
    official = BOOKING_CALENDARS | {k for k, v in cals.items() if isinstance(v, dict) and v.get("type") in ("intro", "demo")}
    mapped = {r["calendar_id"] for r in b2b_read("select calendar_id from calendar_call_type_map where is_active")}
    missing = sorted(mapped - official)
    rooms = q("select value ->> 'test_calendar_id' as test, value ->> 'live_calendar_id' as live "
              "from public.cockpit_sales_settings where key = 'rooms'", write=False)
    test_cal = (rooms[0] or {}).get("test") if rooms else None
    live_cal = (rooms[0] or {}).get("live") if rooms else None
    return [
        {"name": "every calendar B2B's show rate counts is official to the count (C34, D25)", "ok": not missing,
         "detail": f"not official to the count: {missing}" if missing else f"{len(mapped)} calendars, all official"},
        {"name": "rooms.test_calendar_id is not a calendar B2B's show rate counts", "ok": not test_cal or test_cal not in mapped,
         "detail": "not set" if not test_cal else test_cal},
        {"name": "rooms.live_calendar_id is not a calendar B2B's show rate counts", "ok": not live_cal or live_cal not in mapped,
         "detail": "not set" if not live_cal else live_cal},
    ]


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    hard = run_checks.hardening_sql()
    rows = (rolled_back(SETTLE_SQL % {"cal": INTRO_CAL, "hardening": hard})
            + rolled_back(SLOT_SQL % {"hardening": hard})
            + part_c())
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
