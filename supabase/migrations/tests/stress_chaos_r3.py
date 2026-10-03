#!/usr/bin/env python3
"""Chaos round 3 for the live-calls database (3 October 2026), on the real
tables of Creative Triage, inside ONE transaction that always rolls back.

    python3 supabase/migrations/tests/stress_chaos_r3.py

Synthetic rows only (contact ids `stress-chaos-r3-*`, hosts
`chaos-r3-*@stress.invalid`, appointments `stress-chaos-r3-appt-*`); the real
`cockpit_sales_rooms_sweep()` runs inside the transaction with 20261003d
applied first (as stress_chaos.py does), and everything is rolled back, so the
cron sweep never sees these rows. Nothing is posted: the sweep never calls
out, and the tick that posts is not run.

What it attacks
  R3-1. HighLevel is down when a fallback room's link goes: the send's answer
        is lost ("The link may have gone on WhatsApp", never confirmed), so the
        lead never got the link. The setter waits in the Zoom room (Zoom
        reported the meeting and the host's join); the room closes as "the
        lead did not join" ten minutes after it opened. At the intro's start
        + settle, S1 reads the room as evidence that nobody came (no open,
        Zoom reported, every Zoom event read) and queues the intro to be
        marked a no-show in HighLevel: a hard number in B2B's show rate for a
        lead who was never sent the link.
  R3-2. The same with every channel refused outright ("The link did not go on
        any channel"): the link certainly never went.
  R3-3. HELD: the same room with the link sent is still queued (the fix must
        not stop the settle where the lead had the link).

Exit code 0 only when every check passed and nothing persisted.
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

-- A Zoom fallback room for a booked intro that started 21 minutes ago: the
-- host joined (Zoom reported the meeting and the host's join, both read),
-- nobody opened the link, the room closed as "the lead did not join". The
-- link: sent (p_link 'sent'), or never sent with the panel's refusal.
create function pg_temp.room(p_n integer, p_link text, p_refusal text)
returns uuid language plpgsql as $$
declare
  rid uuid;
  st timestamptz := now() - interval '21 minutes';
  appt text := 'stress-chaos-r3-appt-' || p_n;
  contact text := 'stress-chaos-r3-' || p_n;
  host text := 'chaos-r3-' || p_n || '@stress.invalid';
  mtg text := 'stress-chaos-r3-mtg-' || p_n;
begin
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, calendar_id, call_type, start_at, booked_at, status, origin)
  values (appt, contact, 'stress-chaos-cal', 'intro', st, now() - interval '2 days', 'confirmed', 'ghl');
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, result, end_reason,
     join_url, provider_meeting_id, appointment_id, appointment_start_at,
     requested_at, claimed_at, opened_at, link_claimed_at, link_sent_at, link_channels, refusal,
     host_in_at, ends_at, ended_at)
  values (gen_random_uuid(), contact, 'fallback', 'intro', 'zoom', host, host,
          'expired', 'no_join', 'lead_no_show', 'https://zoom.example.invalid/j/3' || p_n, mtg,
          appt, st,
          st - interval '1 minute', st - interval '59 seconds', st - interval '58 seconds', st - interval '57 seconds',
          case when p_link = 'sent' then st - interval '50 seconds' end,
          case when p_link = 'sent' then array['whatsapp_text'] else '{}'::text[] end,
          p_refusal,
          st - interval '40 seconds', st + interval '29 minutes', st + interval '9 minutes')
  returning id into rid;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, handled_at, text, detail)
  values (rid, 'zoom.meeting.started', 'zoom', 'stress-chaos-r3:started:' || p_n, st - interval '45 seconds',
          st - interval '45 seconds', 'Zoom: the meeting started.', jsonb_build_object('event', 'meeting.started')),
         (rid, 'zoom.meeting.participant_joined', 'zoom', 'stress-chaos-r3:host:' || p_n, st - interval '40 seconds',
          st - interval '40 seconds', 'Zoom: someone joined.', jsonb_build_object('event', 'meeting.participant_joined', 'role', 'host'));
  return rid;
end;
$$;

do $$
declare
  a uuid;
  b uuid;
  c uuid;
  ra record;
  rb record;
  qa boolean;
  qb boolean;
  qc boolean;
  ta boolean;
begin
  a := pg_temp.room(1, 'never', 'The link may have gone on WhatsApp. Check the conversation before sending it again, or read it out.');
  b := pg_temp.room(2, 'never', 'The link did not go on any channel (HighLevel did not send it: HighLevel said 429: Too many requests).');
  c := pg_temp.room(3, 'sent', null);
  perform pg_temp.sweep();
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || a::text) into qa;
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || b::text) into qb;
  select exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || c::text) into qc;
  select * into ra from public.cockpit_sales_rooms where id = a;
  select * into rb from public.cockpit_sales_rooms where id = b;
  select exists (select 1 from public.cockpit_sales_alerts
                  where resolved_at is null and (detail ->> 'room_id') = a::text and kind = 'room_mark_intro') into ta;
  perform pg_temp.ck('R3-1 a room whose link may have gone (never confirmed) is not queued to mark its intro a no-show',
    not qa, format('sweep.settle queued %s, settled_mark %s', qa, ra.settled_mark));
  perform pg_temp.ck('R3-1b ... and a person is told to mark that intro (settled_mark none, a mark-this-intro alert)',
    ra.settled_mark = 'none' and ta, format('settled_mark %s, alert %s', ra.settled_mark, ta));
  perform pg_temp.ck('R3-2 a room whose link went on no channel is not queued to mark its intro a no-show',
    not qb, format('sweep.settle queued %s, settled_mark %s', qb, rb.settled_mark));
  perform pg_temp.ck('R3-3 HELD: the same room with its link sent is still queued to be settled',
    qc, format('sweep.settle queued %s', qc));
end;
$$;

select name, ok, detail from pg_temp.chaos_checks order by n;
"""

LEFTOVERS = r"""
select 'room ' || id::text as what from public.cockpit_sales_rooms
 where contact_id like 'stress-chaos-r3-%' or host_email like 'chaos-r3-%@stress.invalid'
union all
select 'event ' || id::text from public.cockpit_sales_room_events where dedupe_key like 'stress-chaos-r3:%'
union all
select 'appointment ' || appointment_id from public.cockpit_sales_appointments where appointment_id like 'stress-chaos-r3-%'
union all
select 'alert ' || id::text from public.cockpit_sales_alerts where subject like 'Room %' and detail ->> 'room_id' in (
  select id::text from public.cockpit_sales_rooms where contact_id like 'stress-chaos-r3-%')
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
