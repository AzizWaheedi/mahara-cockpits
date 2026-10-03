#!/usr/bin/env python3
"""Stress round 3, numbers and data integrity, on the live database (Creative Triage).

    python3 supabase/migrations/tests/stress_numbers_r3.py

The three migrations 20261003a, b and c are applied in production (dark:
every switch off, the tables empty); 20261003d is not, so the run below
applies it first inside its own transaction (run_checks.hardening_sql), as
rounds 1 and 2 do.

ONE transaction that ends in rollback: the real cockpit_sales_rooms_sweep()
on two synthetic closed Zoom rooms for two booked intros that started 25
minutes ago, then which of them its S1 posts to be settled as a no-show.

  confirm: the room was made 20 hours before the intro, for the setter's
           missed confirmation call (the dialer's confirm item carries the
           intro's id and start into the fallback room). Zoom reported the
           meeting and the host; the lead never came to THAT room. Nobody
           coming to a confirmation room the day before says nothing about
           the intro itself: no no-show may be posted.
  start:   the same room made at the intro's own time (one minute after its
           start): Zoom's word that nobody but the host came is evidence,
           and the rule still posts it.

Synthetic rows only: contact and appointment ids start with
'stress-numbers-r3-', host emails end with '@stress.invalid'. Nothing writes
HighLevel, Zoom, Google or Slack; nothing is committed, so the live pg_cron
sweep never sees these rows. Exit code 0 only when every check passed and
nothing persisted. A FAIL is a finding.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"

SETTLE_SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
%(hardening)s
create temp table sr_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, origin)
values ('stress-numbers-r3-appt-confirm', 'stress-numbers-r3-lead-confirm', 'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl'),
       ('stress-numbers-r3-appt-start',   'stress-numbers-r3-lead-start',   'intro', '%(cal)s', now() - interval '25 minutes', 'confirmed', 'ghl');

create temp table sr_rooms (name text primary key, id uuid not null, made timestamptz not null) on commit drop;
with made as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id, appointment_start_at,
     state, result, end_reason, join_url, provider_meeting_id, opened_at, link_sent_at, host_in_at, ended_at)
  values
    -- 1. Made yesterday for the confirmation call (20 hours before the intro).
    (gen_random_uuid(), 'stress-numbers-r3-lead-confirm', 'fallback', 'no_answer', 'intro', 'zoom',
     'confirm@stress.invalid', 'confirm@stress.invalid', 'stress-numbers-r3-appt-confirm', now() - interval '25 minutes',
     'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/73', '73000000003',
     now() - interval '20 hours 24 minutes', now() - interval '20 hours 24 minutes', now() - interval '20 hours 23 minutes',
     now() - interval '20 hours 10 minutes'),
    -- 2. Made at the intro's own time (control).
    (gen_random_uuid(), 'stress-numbers-r3-lead-start', 'fallback', 'no_answer', 'intro', 'zoom',
     'start@stress.invalid', 'start@stress.invalid', 'stress-numbers-r3-appt-start', now() - interval '25 minutes',
     'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/74', '74000000004',
     now() - interval '24 minutes', now() - interval '23 minutes', now() - interval '22 minutes', now() - interval '10 minutes')
  returning id, host_email, opened_at
)
insert into pg_temp.sr_rooms (name, id, made)
select case host_email when 'confirm@stress.invalid' then 'confirm' else 'start' end, id, opened_at from made;
update public.cockpit_sales_rooms as x set requested_at = r.made - interval '30 seconds'
  from pg_temp.sr_rooms as r where r.id = x.id;
-- Zoom reported both meetings: the start and the host's join, both read.
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
select r.id, k.kind, 'zoom', 'stress-numbers-r3:' || r.id::text || ':' || k.kind, r.made + interval '1 minute', r.made + interval '1 minute',
       k.text, case when k.role is null then '{}'::jsonb else jsonb_build_object('role', k.role) end
  from pg_temp.sr_rooms as r
 cross join (values ('zoom.meeting.started', 'The meeting started.', null),
                    ('zoom.meeting.participant_joined', 'The host joined.', 'host')) as k(kind, text, role);

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
  ('confirm-call-room-settles-future-intro: a room made 20 hours before the intro (a missed confirmation call) posts no no-show for the intro',
   not pg_temp.settle_posted('confirm'), 'posted: ' || pg_temp.settle_posted('confirm')),
  ('control: the same Zoom room made at the intro''s time, Zoom reporting only the host, is posted as a no-show',
   pg_temp.settle_posted('start'), 'posted: ' || pg_temp.settle_posted('start'));

select name, ok, detail from pg_temp.sr_checks order by n;
rollback;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-numbers-r3-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-numbers-r3-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-numbers-r3%'
"""


def rolled_back(sql: str) -> list:
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        sys.exit(f"Refusing to run: transaction statements {tx}.")
    return q(sql, write=True)


def main():
    before = q(LEFTOVERS, write=False)
    if before:
        sys.exit(f"Synthetic rows from an earlier run are still there: {[r['what'] for r in before]}. Remove them first.")
    rows = rolled_back(SETTLE_SQL % {"cal": INTRO_CAL, "hardening": run_checks.hardening_sql()})
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
