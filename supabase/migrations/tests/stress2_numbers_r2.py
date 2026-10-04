#!/usr/bin/env python3
"""Second series, round 2, numbers and data integrity, on the live database
(Creative Triage), ONE transaction that ends in rollback.

    python3 supabase/migrations/tests/stress2_numbers_r2.py

settle-wait-burns-tries: sales-api's settle (rooms.ts settle) releases its
event, never finishing it, while it only waits: another room for the same
call is still open with no join (the setter's second try, a link sent from
the lead page after the settle was posted), or the intro's start in the
cockpit's copy is still ahead (the lead moved the intro later through
HighLevel's link, and the copy caught up after S1 posted the settle). Each
of those minutes is a lease, and cockpit_sales_room_event_lease counts a try
at every lease of a settle event (20261003d). After ten, the sweep's E0
gives the settle up as a failure: settled_mark none and the alert "the
no-show could not be written (sales-api or HighLevel did not answer), so the
booked intro is still open". Nothing failed: the settle was waiting, and the
second room may still bring the lead (or the intro is an hour ahead).

The rows below are the state after ten such minutes (tries 10, the last try
a minute ago, unhandled, no lease), then the real sweep (the repo's
20261004a applied inside this transaction). A FAIL is a finding.

Synthetic rows only: contact ids and appointment ids start with
'stress-s2n2-', hosts end with '@stress.invalid'. Nothing is committed, so
no settle reaches sales-api, no alert reaches Slack, and the pg_cron jobs
never see the rows.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402
from stress_numbers import q  # noqa: E402  (the management API call with its 429 wait)

INTRO_CAL = "dsqmJ393Dwl9fDSbIVOI"

SQL = r"""
begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';
-- ===== 20261004a (the repo's fix round 1, rolled back with the rest) =====
{MIG2}
create temp table s2r2_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;
create temp table s2r2_rooms (name text primary key, id uuid not null) on commit drop;

-- Two booked intros. "sib" started 32 minutes ago and is still at that time;
-- "moved" started 32 minutes ago in the copy S1 read, and the copy now says
-- the lead moved it to an hour from now (same appointment id, confirmed).
insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, calendar_id, start_at, status, assigned_user_id, origin)
values ('stress-s2n2-appt-sib',   'stress-s2n2-lead-sib',   'intro', '%(cal)s', now() - interval '32 minutes', 'confirmed', 'G-stress-s2n2', 'ghl'),
       ('stress-s2n2-appt-moved', 'stress-s2n2-lead-moved', 'intro', '%(cal)s', now() + interval '60 minutes', 'confirmed', 'G-stress-s2n2', 'ghl');

-- Each intro's Zoom fallback room A: the link went at +1, the host joined
-- (Zoom reported the meeting), nobody came, R4 closed it at +15. The settle
-- was posted at +21.
with made as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by, appointment_id, appointment_start_at,
     state, result, end_reason, join_url, provider_meeting_id, requested_at, opened_at, link_sent_at, link_channels, host_in_at, ended_at)
  select gen_random_uuid(), 'stress-s2n2-lead-' || v.n, 'fallback', 'no_answer', 'intro', 'zoom',
         'setter-s2n2@stress.invalid', 'setter-s2n2@stress.invalid', 'stress-s2n2-appt-' || v.n,
         now() - interval '32 minutes', 'expired', 'no_join', 'lead_no_show',
         'https://us06web.zoom.us/j/8' || v.k || '?pwd=stress', '8' || v.k,
         now() - interval '31 minutes', now() - interval '31 minutes', now() - interval '31 minutes', array['whatsapp_text'],
         now() - interval '30 minutes', now() - interval '17 minutes'
    from (values ('sib', '1234500001'), ('moved', '1234500002')) as v(n, k)
  returning id, contact_id
)
insert into pg_temp.s2r2_rooms (name, id) select 'a-' || substr(contact_id, length('stress-s2n2-lead-') + 1), id from made;

insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
select r.id, 'zoom.meeting.started', 'zoom', 'stress-s2n2:zoom.started:' || r.id::text, now() - interval '30 minutes',
       now() - interval '30 minutes', 'Zoom: the meeting started.', jsonb_build_object('role', 'host')
  from pg_temp.s2r2_rooms as r;

-- The settle S1 posted at +21, after ten minutes of sales-api leasing it
-- (ten tries counted by the lease) and releasing it each time while it
-- waited: unhandled, no lease, the last try a minute ago.
insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text, detail, tries, last_try_at)
select r.id, 'sweep.settle', 'settle', 'sweep.settle:' || r.id::text, now() - interval '11 minutes',
       'Due to be settled: the room for a booked intro closed with nobody joining.',
       jsonb_build_object('appointment_id', 'stress-s2n2-appt-' || substr(r.name, 3)), 10, now() - interval '1 minute'
  from pg_temp.s2r2_rooms as r;

-- "sib": at +22 the lead wrote "can we talk now?" and the setter sent a new
-- link from the lead page (a plain room, no appointment): open, the host in,
-- waiting for the lead.
with b as (
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, trigger, call_kind, provider, host_email, made_by,
     state, join_url, provider_meeting_id, requested_at, opened_at, link_sent_at, link_channels, host_in_at, lead_by, ends_at)
  values (gen_random_uuid(), 'stress-s2n2-lead-sib', 'manual', 'manual', 'intro', 'zoom',
          'setter-s2n2@stress.invalid', 'setter-s2n2@stress.invalid', 'host_in',
          'https://us06web.zoom.us/j/81234500003?pwd=stress', '81234500003',
          now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '10 minutes', array['whatsapp_text'],
          now() - interval '9 minutes', now() + interval '5 minutes', now() + interval '20 minutes')
  returning id
)
insert into pg_temp.s2r2_rooms (name, id) select 'b-sib', id from b;

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
  insert into pg_temp.s2r2_checks (name, ok, detail)
  values ('the sweep ran here and raised no rule error', not (r ? 'skipped') and coalesce(jsonb_array_length(r -> 'errors'), 0) = 0,
          left((r -> 'errors')::text, 300));
end $$;

create function pg_temp.room_of(p_name text) returns public.cockpit_sales_rooms language sql as $f$
  select x.* from public.cockpit_sales_rooms as x join pg_temp.s2r2_rooms as r on r.id = x.id where r.name = p_name
$f$;
create function pg_temp.gave_up_alert(p_name text) returns text language sql as $f$
  select a.message from public.cockpit_sales_alerts as a
    join pg_temp.s2r2_rooms as r on a.dedupe_key = 'room:' || r.id::text || ':mark_intro'
   where r.name = p_name and a.resolved_at is null limit 1
$f$;

insert into pg_temp.s2r2_checks (name, ok, detail)
select 'settle-wait-burns-tries (an open sibling): the first room''s settle only waited for the second try''s open room; the sweep must not give it up as "the no-show could not be written"',
       (pg_temp.room_of('a-sib')).settled_mark is distinct from 'none' and pg_temp.gave_up_alert('a-sib') is null,
       format('room A settled_mark %s; room B state %s; alert: %s', coalesce((pg_temp.room_of('a-sib')).settled_mark, 'null'),
              (pg_temp.room_of('b-sib')).state, coalesce(pg_temp.gave_up_alert('a-sib'), 'none'));

insert into pg_temp.s2r2_checks (name, ok, detail)
select 'settle-wait-burns-tries (the intro moved later): the lead moved the intro to an hour from now; the sweep must not say "the no-show could not be written ... the booked intro is still open" about it',
       pg_temp.gave_up_alert('a-moved') is null,
       format('room A settled_mark %s; alert: %s', coalesce((pg_temp.room_of('a-moved')).settled_mark, 'null'),
              coalesce(pg_temp.gave_up_alert('a-moved'), 'none'));

select name, ok, detail from pg_temp.s2r2_checks order by n;
rollback;
""".replace("%(cal)s", INTRO_CAL)

SQL = SQL.replace(
    "{MIG2}",
    run_checks.strip_transaction(run_checks.HARDENING_2, open(os.path.join(run_checks.MIGRATIONS, run_checks.HARDENING_2)).read()),
)

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms where contact_id like 'stress-s2n2-%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-s2n2-%'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-s2n2:%'
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
    rows = rolled_back(SQL)
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
