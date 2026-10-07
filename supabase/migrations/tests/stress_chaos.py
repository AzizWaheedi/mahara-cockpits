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

Chaos round 2 (3 October 2026)
  C3. sales-api, the sales-live cron door or HighLevel is out for three
      minutes when a fallback room's booked intro falls due to be settled.
      Settle events still count a try when the sweep only picks them (the
      round-1 fix moved that to the lease for every other source), so after
      three picks nobody answered, E0 gives the settle up. The room is never
      queued again (the settle's dedupe key is taken), its settled_mark stays
      null, no alert names the room (the watchdog's per-event alert covers
      Zoom joins and worker events only, and its daily count calls these
      "Zoom, Slack, worker or claim" signals), and the intro stays
      "confirmed", which B2B's show rate counts as shown.
  C4. The door's room lookup has 500 ms (BUDGET.zoomFind); past that it stores
      the lead's Zoom join with room_id null for sales-api to place. While
      sales-api is down, that join is invisible to everything the sweep reads
      by room_id: R4's pending-events hold, its events_lost check and S1's
      "a Zoom event for this room was not read" doubt. The room closes as
      "the lead did not join" at its deadline with no hold, and its booked
      intro is queued to be marked a no-show.
  C5. The tick posts to sales-live/cron and drops pg_net's request id. A
      door that refuses every post (a CRON_SECRET that no longer matches the
      vault, sales-live deployed with verify_jwt on, or not deployed) answers
      401 into net._http_response, which nobody reads: the sweep's row stays
      green ("N events sent back to room.event") while no replay, settle or
      re-check ever reaches sales-api. The posts here never leave: they are
      uncommitted queue rows, rolled back with everything else.

Exit code 0 only when every check passed and nothing persisted. The run
applies 20261003d inside its transaction first, so it checks the repo's
sweep and lease (fixed there: C1 and C3 tries are counted at the lease,
never at the pick, and a settle given up leaves a "mark this intro" alert;
C2 the guard stamps the database's clock; C4 the sweep places an unplaced
Zoom event by its meeting id before any rule reads the room's events; C5 the
tick keeps each post's request id and reads its answer on the next run).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_checks  # noqa: E402  (token handling and the management API call; never prints the token)
from fence_switches import SETTLE_ON, switches_on  # noqa: E402

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

-- ================================================================ round 2

-- A minute (or more) passes for the round-2 rows: every synthetic room's
-- times (also appointment_start_at), every event of those rooms whatever its
-- key (the sweep's own settle events), and the synthetic appointments.
create function pg_temp.pass2(p_secs integer)
returns void language plpgsql as $$
declare d interval := make_interval(secs => p_secs);
begin
  update public.cockpit_sales_rooms
     set requested_at = requested_at - d, claimed_at = claimed_at - d, opened_at = opened_at - d,
         link_sent_at = link_sent_at - d, host_in_at = host_in_at - d, lead_in_at = lead_in_at - d,
         host_by = host_by - d, lead_by = lead_by - d, ends_at = ends_at - d, ended_at = ended_at - d,
         link_claimed_at = link_claimed_at - d, appointment_start_at = appointment_start_at - d
   where contact_id like 'stress-chaos-r2-%' and host_email like '%@stress.invalid';
  update public.cockpit_sales_room_events
     set at = at - d, last_try_at = last_try_at - d, lease_until = lease_until - d, handled_at = handled_at - d
   where dedupe_key like 'stress-chaos-r2:%'
      or room_id in (select id from public.cockpit_sales_rooms where contact_id like 'stress-chaos-r2-%');
  update public.cockpit_sales_appointments
     set start_at = start_at - d, booked_at = booked_at - d
   where appointment_id like 'stress-chaos-r2-appt-%';
end;
$$;

-- ---------------------------------------------------------------- C3
do $$
declare
  rid uuid;
  st timestamptz := now() - interval '21 minutes';
  e record;
  r record;
  waiting boolean;
  told boolean;
begin
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, booked_at, status, origin)
  values ('stress-chaos-r2-appt-3', 'stress-chaos-r2-3', 'stress-chaos-cal', 'intro', st, now() - interval '2 days', 'confirmed', 'ghl');
  -- The fallback room for that intro closed as a no-show 9 minutes ago: a
  -- Zoom room whose events were all read, a link never opened (no doubt).
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, result, end_reason,
     join_url, provider_meeting_id, appointment_id, appointment_start_at,
     requested_at, claimed_at, opened_at, link_sent_at, link_claimed_at, host_in_at, lead_by, ends_at, ended_at)
  values (gen_random_uuid(), 'stress-chaos-r2-3', 'fallback', 'intro', 'zoom', 'chaos-r2-3@stress.invalid', 'chaos-r2-3@stress.invalid',
          'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/23', 'stress-chaos-r2-mtg-3',
          'stress-chaos-r2-appt-3', st,
          st - interval '1 minute', st - interval '59 seconds', st - interval '58 seconds', st - interval '50 seconds',
          st - interval '51 seconds', st - interval '40 seconds', st + interval '10 minutes', st + interval '29 minutes',
          st + interval '12 minutes')
  returning id into rid;
  -- Zoom reported the meeting (its start, read by room.event): Zoom's
  -- silence about the lead is then evidence that nobody came (20261003d).
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at)
  values (rid, 'zoom.meeting.started', 'zoom', 'stress-chaos-r2:started:3', st - interval '40 seconds', st - interval '40 seconds');

  -- Minute 1: due (start + settle passed); the sweep queues and picks it.
  -- sales-api is mid-deploy (or the cron door is down, or HighLevel cannot
  -- be read and room.event releases it): nothing answers for three minutes.
  perform pg_temp.sweep();
  select * into e from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || rid::text;
  perform pg_temp.pass2(60);
  perform pg_temp.sweep();
  perform pg_temp.pass2(60);
  perform pg_temp.sweep();
  perform pg_temp.pass2(60);
  perform pg_temp.sweep();
  select * into e from public.cockpit_sales_room_events
   where room_id = rid and kind = 'sweep.settle';
  perform pg_temp.ck('C3a a due settle is still waiting for room.event after a 3-minute outage (not given up)',
    e.id is not null and e.handled_at is null,
    format('event %s, tries %s, handled_at %s, gave_up %s', e.id, e.tries, e.handled_at, e.detail ->> 'gave_up'));

  -- Everything is back. Five more minutes of sweeps.
  for i in 1 .. 5 loop
    perform pg_temp.pass2(60);
    perform pg_temp.sweep();
  end loop;
  select * into r from public.cockpit_sales_rooms where id = rid;
  select exists (select 1 from public.cockpit_sales_room_events
                  where room_id = rid and kind = 'sweep.settle' and handled_at is null) into waiting;
  select exists (select 1 from public.cockpit_sales_alerts
                  where resolved_at is null and (detail ->> 'room_id') = rid::text) into told;
  perform pg_temp.ck('C3b after the outage the intro is settled, still queued, or a person is told which room to mark',
    r.settled_mark is not null or waiting or told,
    format('settled_mark %s, settle waiting %s, alert naming the room %s', r.settled_mark, waiting, told));
end;
$$;

-- ---------------------------------------------------------------- C4
do $$
declare
  rid uuid;
  st timestamptz := now() - interval '2 minutes';
  r record;
  settle_queued boolean;
begin
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, booked_at, status, origin)
  values ('stress-chaos-r2-appt-4', 'stress-chaos-r2-4', 'stress-chaos-cal', 'intro', st, now() - interval '2 days', 'confirmed', 'ghl');
  -- The setter is in the Zoom fallback room; the link went 9.5 minutes ago,
  -- the lead has 30 seconds left on the panel's clock.
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
     join_url, provider_meeting_id, appointment_id, appointment_start_at,
     requested_at, claimed_at, opened_at, link_sent_at, link_claimed_at, host_in_at, host_by, lead_by, ends_at)
  values (gen_random_uuid(), 'stress-chaos-r2-4', 'fallback', 'intro', 'zoom', 'chaos-r2-4@stress.invalid', 'chaos-r2-4@stress.invalid',
          'host_in', 'https://zoom.example.invalid/j/24', 'stress-chaos-r2-mtg-4', 'stress-chaos-r2-appt-4', st,
          now() - interval '11 minutes', now() - interval '11 minutes', now() - interval '10 minutes',
          now() - interval '570 seconds', now() - interval '571 seconds', now() - interval '9 minutes',
          now() + interval '6 minutes', now() + interval '30 seconds', now() + interval '25 minutes')
  returning id into rid;
  -- The lead joins. The door's room lookup ran past its 500 ms, so it
  -- stored the join with no room for sales-api to place; sales-api is down.
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text, detail)
  values (null, 'zoom.meeting.participant_joined', 'zoom', 'stress-chaos-r2:join:4', now() - interval '20 seconds',
          'Zoom: someone joined.',
          jsonb_build_object('event', 'meeting.participant_joined',
                             'payload', jsonb_build_object('object', jsonb_build_object('id', 'stress-chaos-r2-mtg-4',
                               'topic', 'Mahara call ABCDEF',
                               'participant', jsonb_build_object('user_name', 'Lead', 'email', 'lead4@stress.invalid')))));

  perform pg_temp.sweep();
  perform pg_temp.pass2(60);
  perform pg_temp.sweep();
  select * into r from public.cockpit_sales_rooms where id = rid;
  perform pg_temp.ck('C4a a room whose lead''s Zoom join is stored unplaced (room lookup timed out) is held like one placed, not closed as a no-show at once',
    r.state = 'host_in', format('state %s, end_reason %s, result %s', r.state, r.end_reason, r.result));

  -- sales-api stays down past the intro's start + settle.
  perform pg_temp.pass2(1200);
  perform pg_temp.sweep();
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || rid::text)
    into settle_queued;
  perform pg_temp.ck('C4b the booked intro is not queued to be marked a no-show while the lead''s stored join was never read',
    not settle_queued, format('sweep.settle queued: %s', settle_queued));
end;
$$;

-- ---------------------------------------------------------------- C5
-- The tick posts to sales-live/cron with pg_net and drops the request id.
-- Here the door refuses every post (a CRON_SECRET that no longer matches the
-- vault's cockpit_sync_secret, sales-live deployed with verify_jwt on, or not
-- deployed at all): pg_net records the 401s in net._http_response, and
-- nothing reads them. Nothing is sent: the posts sit in this transaction's
-- uncommitted net.http_request_queue rows and are rolled back with it.
do $$
declare
  rid uuid;
  before_id bigint;
  r jsonb;
  posted bigint[];
  st record;
  told boolean;
begin
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state,
     join_url, provider_meeting_id, requested_at, claimed_at, opened_at, host_by, ends_at)
  values (gen_random_uuid(), 'stress-chaos-r2-5', 'manual', 'intro', 'zoom', 'chaos-r2-5@stress.invalid', 'chaos-r2-5@stress.invalid',
          'open', 'https://zoom.example.invalid/j/25', 'stress-chaos-r2-mtg-5',
          now() - interval '30 seconds', now() - interval '29 seconds', now() - interval '20 seconds',
          now() + interval '14 minutes', now() + interval '29 minutes')
  returning id into rid;
  select coalesce(max(q.id), 0) into before_id from net.http_request_queue as q;
  r := public.cockpit_sales_rooms_tick();
  if r ? 'skipped' then
    raise exception 'chaos: the live sweep held the lock; run again';
  end if;
  select coalesce(array_agg(q.id), '{}') into posted
    from net.http_request_queue as q
   where q.id > before_id and q.url like '%/functions/v1/sales-live/cron';
  -- The door's gateway answered every one 401.
  insert into net._http_response (id, status_code, content_type, content, timed_out, error_msg, created)
  select p, 401, 'application/json', '{"ok":false,"error":"Not allowed."}', false, null, now()
    from unnest(posted) as p;
  perform pg_temp.pass2(60);
  r := public.cockpit_sales_rooms_tick();
  if r ? 'skipped' then
    raise exception 'chaos: the live sweep held the lock; run again';
  end if;
  select s.ok, s.detail into st from public.cockpit_sales_worker_status as s where s.worker = 'sales-api' and s.job = 'sweep';
  select exists (select 1 from public.cockpit_sales_alerts as a
                  where a.resolved_at is null and a.raised_at >= now() - interval '1 minute'
                    and (a.message ilike '%sales-live%' or a.message ilike '%401%' or a.subject ilike '%sweep%'))
    into told;
  perform pg_temp.ck('C5 the sweep''s posts that the cron door refused (401) turn its status row red or raise an alert',
    cardinality(posted) > 0 and (st.ok is false or told),
    format('posts %s, sweep row ok %s (%s), alert %s', cardinality(posted), st.ok, left(st.detail, 120), told));
end;
$$;

select name, ok, detail from pg_temp.chaos_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms
 where contact_id like 'stress-chaos-%' or host_email like 'chaos%@stress.invalid'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-chaos:%'
   or dedupe_key like 'stress-chaos-r2:%'
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
                     run_checks.hardening_sql(),
                     # Milestone 1 ships the settle off; this run plays S1, so a manager turns it on (rolled back).
                     switches_on(SETTLE_ON), CHAOS, "rollback;"])
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
