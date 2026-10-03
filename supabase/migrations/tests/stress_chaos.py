#!/usr/bin/env python3
"""Chaos round 1 for the live-calls database (3 October 2026), on the real
tables of Creative Triage, inside ONE transaction that always rolls back.

    python3 supabase/migrations/tests/stress_chaos.py

The three migrations (20261003a, b, c) are applied in production, dark: every
switch off, the tables empty. These checks use synthetic rows only (contact
ids starting `stress-chaos-`, hosts ending `@stress.invalid`, one appointment
`stress-chaos-appt-1`), run the real `cockpit_sales_rooms_sweep()` inside the
transaction, and roll everything back, so nothing they make outlives the run
and the cron sweep never sees them. Nothing is posted: the sweep itself never
calls out (the tick that posts is not run), and a rollback drops anything
pg_net queued.

Time inside a transaction stands still (now() is the transaction's start), so
"a minute passes" is simulated by moving every timestamp of the synthetic
rows one minute into the past, which is what the next minute's sweep sees.

What it attacks
  C1. sales-api (or the sales-live door) is down for four minutes. The lead
      joins the Zoom room; the door stores the join. The sweep picks it for
      replay each minute and counts a try each time it picks it, whether or
      not anything answered; after the third pick it gives the event up. The
      join is then never applied, the room closes as "the lead did not join",
      and the booked intro is queued to be settled as a no-show, while the
      lead was on the call.
  C2. The VPS clock runs behind the database's. The worker writes
      claimed_at, opened_at, host_by and ends_at from its own clock, and the
      sweep judges them on the database's: a room claimed a second ago fails
      as "took more than two minutes", and a handover room opened a second
      ago expires before the closer can join.

Exit code 0 only when every check passed and nothing persisted. The run
applies 20261003d inside its transaction first, so it checks the repo's
sweep and lease (fixed there: C1 tries are counted at the lease, never at
the pick; C2 the guard stamps the database's clock).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402  (token handling and the management API call; never prints the token)

CHAOS = r"""
create temp table chaos_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.chaos_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

-- One sweep, as the cron job's minute runs it. Refuses to go on when the
-- live cron sweep holds the lock this very moment (the runner tries again).
create function pg_temp.sweep()
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public.cockpit_sales_rooms_sweep();
  if r ? 'skipped' then
    raise exception 'chaos: the live sweep held the lock; run again';
  end if;
  return r;
end;
$$;

-- A minute (or more) passes for the synthetic rows only.
create function pg_temp.pass(p_secs integer)
returns void language plpgsql as $$
declare d interval := make_interval(secs => p_secs);
begin
  update public.cockpit_sales_rooms
     set requested_at = requested_at - d, claimed_at = claimed_at - d, opened_at = opened_at - d,
         link_sent_at = link_sent_at - d, host_in_at = host_in_at - d, lead_in_at = lead_in_at - d,
         host_by = host_by - d, lead_by = lead_by - d, ends_at = ends_at - d, ended_at = ended_at - d,
         link_claimed_at = link_claimed_at - d
   where contact_id like 'stress-chaos-%' and host_email like '%@stress.invalid';
  update public.cockpit_sales_room_events
     set at = at - d, last_try_at = last_try_at - d, lease_until = lease_until - d, handled_at = handled_at - d
   where dedupe_key like 'stress-chaos:%';
  update public.cockpit_sales_appointments
     set start_at = start_at - d, booked_at = booked_at - d
   where appointment_id like 'stress-chaos-appt-%';
end;
$$;

-- ---------------------------------------------------------------- C1
do $$
declare
  rid uuid;
  ev uuid;
  e record;
  r record;
  settle_queued boolean;
begin
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, booked_at, status, origin)
  values ('stress-chaos-appt-1', 'stress-chaos-1', 'stress-chaos-cal', 'intro', now() - interval '11 minutes',
          now() - interval '2 days', 'confirmed', 'ghl');
  -- A fallback room for that booked intro: the host is in, the link went a
  -- minute ago, the lead has 9 minutes left.
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, provider_meeting_id,
     appointment_id, requested_at, claimed_at, opened_at, link_sent_at, link_claimed_at, host_in_at,
     host_by, lead_by, ends_at)
  values (gen_random_uuid(), 'stress-chaos-1', 'fallback', 'intro', 'zoom', 'chaos1@stress.invalid', 'chaos1@stress.invalid',
          'host_in', 'https://zoom.example.invalid/j/9', 'stress-chaos-mtg-1', 'stress-chaos-appt-1',
          now() - interval '90 seconds', now() - interval '88 seconds', now() - interval '80 seconds',
          now() - interval '60 seconds', now() - interval '61 seconds', now() - interval '50 seconds',
          now() + interval '10 minutes', now() + interval '9 minutes', now() + interval '25 minutes')
  returning id into rid;
  -- The lead joins; the door stores the Zoom event (its forward then fails:
  -- sales-api is down).
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text, detail)
  values (rid, 'zoom.meeting.participant_joined', 'zoom', 'stress-chaos:join:1', now() - interval '25 seconds',
          'Zoom: someone joined.',
          jsonb_build_object('event', 'meeting.participant_joined',
                             'payload', jsonb_build_object('object', jsonb_build_object('id', 'stress-chaos-mtg-1',
                               'participant', jsonb_build_object('user_name', 'Lead', 'email', 'lead@stress.invalid')))))
  returning id into ev;

  -- Four minutes of sales-api outage: each minute the sweep picks the
  -- event for the replay, and nothing answers.
  perform pg_temp.sweep();
  perform pg_temp.pass(60);
  perform pg_temp.sweep();
  perform pg_temp.pass(60);
  perform pg_temp.sweep();
  perform pg_temp.pass(60);
  perform pg_temp.sweep();
  select * into e from public.cockpit_sales_room_events where id = ev;
  perform pg_temp.ck('C1a a lead''s Zoom join is still waiting for room.event after a 4-minute sales-api outage (not given up)',
    e.handled_at is null and coalesce((e.detail ->> 'gave_up')::boolean, false) = false,
    format('tries %s, handled_at %s, gave_up %s', e.tries, e.handled_at, e.detail ->> 'gave_up'));

  -- sales-api is back. The lead's 10 minutes run out on the panel's clock.
  perform pg_temp.pass(420);
  perform pg_temp.sweep();
  select * into r from public.cockpit_sales_rooms where id = rid;
  perform pg_temp.ck('C1b a room whose lead''s join the door stored is never closed as a no-show',
    not (r.state = 'expired' and r.end_reason = 'lead_no_show'),
    format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result));
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || rid::text)
    into settle_queued;
  perform pg_temp.ck('C1c the booked intro of a lead who joined is not queued to be marked a no-show in HighLevel',
    not settle_queued, format('sweep.settle queued: %s', settle_queued));
end;
$$;

-- ---------------------------------------------------------------- C2
do $$
declare
  a uuid;
  b uuid;
  ra record;
  rb record;
  vps_behind constant interval := interval '125 seconds';
begin
  -- sales-api asks for a Zoom room on the database's clock; the worker
  -- claims it one second later on a VPS clock 125 s behind (its claim is
  -- an update: requested to creating, with its own claimed_at).
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, requested_at)
  values (gen_random_uuid(), 'stress-chaos-2', 'manual', 'intro', 'zoom', 'chaos2@stress.invalid', 'chaos2@stress.invalid',
          'requested', now() - interval '2 seconds')
  returning id into a;
  update public.cockpit_sales_rooms
     set state = 'creating', claimed_at = now() - interval '1 second' - vps_behind, worker_run = 'stress-chaos-run'
   where id = a;
  -- A closer's handover room opened a second ago by a VPS 3 minutes behind:
  -- the worker's open writes opened_at and host_by = its clock + handover_host (120 s).
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, requested_at, worker_run)
  values (gen_random_uuid(), 'stress-chaos-3', 'handover', 'demo', 'zoom', 'chaos3@stress.invalid', 'chaos3@stress.invalid',
          'creating', now() - interval '6 seconds', 'stress-chaos-run')
  returning id into b;
  update public.cockpit_sales_rooms
     set state = 'open', join_url = 'https://zoom.example.invalid/j/10', provider_meeting_id = 'stress-chaos-mtg-3',
         claimed_at = now() - interval '5 seconds' - interval '180 seconds',
         opened_at = now() - interval '1 second' - interval '180 seconds',
         host_by = now() - interval '1 second' - interval '180 seconds' + interval '120 seconds',
         ends_at = now() - interval '1 second' - interval '180 seconds' + interval '60 minutes'
   where id = b;
  perform pg_temp.sweep();
  select * into ra from public.cockpit_sales_rooms where id = a;
  select * into rb from public.cockpit_sales_rooms where id = b;
  perform pg_temp.ck('C2a a room claimed a second ago (VPS 125 s behind) is not failed as taking more than two minutes',
    ra.state = 'creating', format('state %s, end_reason %s', ra.state, ra.end_reason));
  perform pg_temp.ck('C2b a handover room opened a second ago (VPS 3 minutes behind) still gives the closer their 120 s',
    rb.state = 'open', format('state %s, end_reason %s', rb.state, rb.end_reason));
end;
$$;

select name, ok, detail from pg_temp.chaos_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms
 where contact_id like 'stress-chaos-%' or host_email like 'chaos%@stress.invalid'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-chaos:%'
   or room_id in (select id from public.cockpit_sales_rooms where contact_id like 'stress-chaos-%')
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-chaos-%'
union all
select 'audit ' || id::text from public.cockpit_audit_log
 where entity_type = 'cockpit_sales_rooms' and metadata ->> 'code' is not null
   and entity_id in (select id::text from public.cockpit_sales_rooms where contact_id like 'stress-chaos-%')
"""


def compose() -> str:
    sql = "\n".join(["begin;", "set local lock_timeout = '5s';", "set local statement_timeout = '90s';",
                     "-- ===== 20261003d (the repo's hardening, rolled back with the rest) =====",
                     run_checks.hardening_sql(), CHAOS, "rollback;"])
    tx = [s.lower() for s in run_checks.top_level_statements(sql) if run_checks.TX.match(s)]
    if tx != ["begin", "rollback"]:
        raise SystemExit(f"Refusing to run: the composed SQL has transaction statements {tx}.")
    return sql


def main() -> None:
    before = run_checks.query(LEFTOVERS, write=False) or []
    if before:
        raise SystemExit(f"Synthetic chaos rows exist before the run; not touching them: {[r['what'] for r in before]}")
    rows = None
    for attempt in range(3):
        try:
            rows = run_checks.query(compose(), write=True) or []
            break
        except SystemExit as e:
            if "live sweep held the lock" in str(e) and attempt < 2:
                continue
            raise
    failed = [r for r in rows if not r.get("ok")]
    for r in rows:
        print(f"{'PASS' if r.get('ok') else 'FAIL'}  {r.get('name')}" + (f"  ({r.get('detail')})" if r.get("detail") else ""))
    print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed, {len(rows)} checks.")
    after = run_checks.query(LEFTOVERS, write=False) or []
    if after:
        print("LEFT BEHIND after the rollback:", [r["what"] for r in after])
        sys.exit(1)
    print("Nothing persisted: every synthetic row was rolled back.")
    sys.exit(0 if rows and not failed else 1)


if __name__ == "__main__":
    main()
